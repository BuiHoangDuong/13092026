import { createHash } from "node:crypto";
import { db, Prisma, type ActorType, type PayoutExecution } from "@cashback/db";
import { assertLease, lockCashback, withJobLease, type JobLease } from "./jobs.js";
import { assertMoneyFlowMode, readMoneyFlowMode } from "./money-gate.js";
import { PublicAccessError } from "./rate-limit.js";
import { getInternalTransferPort, PAYOUT_EXCHANGES, type TransferOutcome } from "../payout/internal-transfer.js";
import { INTERNAL_USDT_POLICY, approvalStillValid, canSend, commandAllowed, currentSlotAt, decideExecution, mayDispatchNow, nextSlotAfter, primaryReason, type Blocker } from "../payout/internal-usdt-policy.js";

const D = Prisma.Decimal;
export const PAYOUT_ASSET = "USDT";
const OPEN_STATES = ["AWAITING_APPROVAL", "READY", "DISPATCHING", "SUBMITTED", "UNKNOWN"] as const;
const IN_FLIGHT = ["DISPATCHING", "SUBMITTED", "UNKNOWN"] as const;
const free = (p: { entitlement: Prisma.Decimal; settledAmount: Prisma.Decimal; activeAmount: Prisma.Decimal }) => p.entitlement.minus(p.settledAmount).minus(p.activeAmount);
const sum = (values: Prisma.Decimal[]) => values.reduce((total, value) => total.plus(value), new D(0));
type Tx = Prisma.TransactionClient;
type Actor = { type: ActorType; id?: string };

async function audit(tx: Tx, event: { uidAccountId: string; executionId?: string; payableId?: string; kind: string; actor?: Actor; detail?: Prisma.InputJsonValue }) {
  await tx.payableEvent.create({ data: { uidAccountId: event.uidAccountId, executionId: event.executionId, payableId: event.payableId, kind: event.kind, actorType: event.actor?.type ?? "SYSTEM", actorId: event.actor?.id, detail: event.detail } });
}
async function completeJob(lease: JobLease) {
  await db.$transaction(async tx => {
    await assertLease(tx, lease);
    const done = await tx.job.updateMany({ where: { id: lease.id, lockedBy: lease.lockedBy, state: "CLAIMED" }, data: { state: "DONE", lockedBy: null, leaseUntil: null, lastError: null } });
    if (done.count !== 1) throw new Error("LEASE_LOST");
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Source change + sync (Req 22.16-22.18)
// ---------------------------------------------------------------------------------------------------------------

/** Called inside the transaction that changes wallet availability, so the sync request is never lost (Req 22.17). */
export async function markPayableSourceChanged(tx: Tx, uidAccountId: string, asset: string) {
  await tx.payableSyncScope.upsert({ where: { uidAccountId_asset: { uidAccountId, asset } }, create: { uidAccountId, asset, sourceVersion: 1, state: "PENDING" }, update: { sourceVersion: { increment: 1 }, state: "PENDING" } });
  const payload = { uidAccountId, asset };
  if (!await tx.job.findFirst({ where: { type: "SYNC_PAYABLES", state: "PENDING", payload: { equals: payload } }, select: { id: true } })) await tx.job.create({ data: { type: "SYNC_PAYABLES", payload } });
}

/** One payable per HOLD_RELEASE entry; UNIQUE(sourceReleaseEntryId) makes a replayed sync a no-op (Req 22.14). */
async function createMissingPayables(tx: Tx, exchangeId: string, uidAccountId: string, asset: string, walletId: string) {
  let created = 0;
  const releases = await tx.walletEntry.findMany({ where: { walletId, type: "HOLD_RELEASE", payable: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  for (const entry of releases) {
    if (!entry.amount.greaterThan(0)) continue;
    const payable = await tx.customerPayable.create({ data: { uidAccountId, exchangeId, asset, sourceReleaseEntryId: entry.id, entitlement: entry.amount, releasedAt: entry.createdAt } });
    await audit(tx, { uidAccountId, payableId: payable.id, kind: "PAYABLE_CREATED", detail: { amount: entry.amount.toFixed(10), sourceReleaseEntryId: entry.id } });
    created++;
  }
  return created;
}

/** Applies every released cashback that has no payable yet, then proves the ledger algebra: sum(free) == wallet.available. */
export async function syncPayableScope(tx: Tx, uidAccountId: string, asset: string) {
  const scope = await tx.payableSyncScope.upsert({ where: { uidAccountId_asset: { uidAccountId, asset } }, create: { uidAccountId, asset, sourceVersion: 1, state: "PENDING" }, update: {} });
  const version = scope.sourceVersion;
  const account = await tx.uidAccount.findUniqueOrThrow({ where: { id: uidAccountId } });
  const wallet = await tx.wallet.findUnique({ where: { uidAccountId_asset: { uidAccountId, asset } } });
  const created = wallet ? await createMissingPayables(tx, account.exchangeId, uidAccountId, asset, wallet.id) : 0;
  const open = await tx.customerPayable.findMany({ where: { uidAccountId, asset, closedAt: null } });
  const available = wallet?.available ?? new D(0);
  const free_ = sum(open.map(free));
  const invariantError = free_.equals(available) ? null : `AVAILABLE_MISMATCH:ledger=${free_.toFixed(10)} wallet=${available.toFixed(10)}`;
  const latest = await tx.payableSyncScope.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId, asset } } });
  await tx.payableSyncScope.update({ where: { uidAccountId_asset: { uidAccountId, asset } }, data: invariantError
    ? { state: "FAILED", invariantError, lastError: "INVARIANT", appliedVersion: version }
    : { state: latest.sourceVersion === version ? "SYNCED" : "PENDING", invariantError: null, lastError: null, appliedVersion: version, lastAppliedAt: new Date() } });
  if (latest.sourceVersion !== version && !await tx.job.findFirst({ where: { type: "SYNC_PAYABLES", state: "PENDING", payload: { equals: { uidAccountId, asset } } } })) await tx.job.create({ data: { type: "SYNC_PAYABLES", payload: { uidAccountId, asset } } });
  return { created, invariantError };
}
export async function syncPayablesJob(lease: JobLease, payload: { uidAccountId: string; asset: string }) {
  return withJobLease(lease, async tx => { await lockCashback(tx); return syncPayableScope(tx, payload.uidAccountId, payload.asset); });
}

// ---------------------------------------------------------------------------------------------------------------
// Allocation algebra: reserve / release / settle (Req 22.10, balance model T, S, R)
// ---------------------------------------------------------------------------------------------------------------

async function reserveAllocation(tx: Tx, execution: { id: string; uidAccountId: string }, payable: { id: string; asset: string; entitlement: Prisma.Decimal; settledAmount: Prisma.Decimal; activeAmount: Prisma.Decimal }) {
  const amount = free(payable);
  if (!amount.greaterThan(0)) return new D(0);
  const allocation = await tx.payableAllocation.create({ data: { executionId: execution.id, payableId: payable.id, amount } });
  await tx.customerPayable.update({ where: { id: payable.id }, data: { activeAmount: payable.activeAmount.plus(amount), version: { increment: 1 } } });
  const wallet = await tx.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: execution.uidAccountId, asset: payable.asset } } });
  if (wallet.available.lessThan(amount)) throw new Error("WALLET_AVAILABLE_INVARIANT");
  await tx.wallet.update({ where: { id: wallet.id }, data: { available: wallet.available.minus(amount), reserved: wallet.reserved.plus(amount) } });
  await tx.walletEntry.create({ data: { walletId: wallet.id, type: "WITHDRAWAL_RESERVE", amount, sourceRef: allocation.id, opKey: `allocation:${allocation.id}:reserve`, balanceChanges: { available: amount.negated().toFixed(10), reserved: amount.toFixed(10) } } });
  return amount;
}

/** ACTIVE -> RELEASED or SETTLED exactly once; wallet and payable counters move in the same transaction. */
async function closeAllocations(tx: Tx, executionId: string, to: "RELEASED" | "SETTLED") {
  const allocations = await tx.payableAllocation.findMany({ where: { executionId, state: "ACTIVE" }, include: { payable: true }, orderBy: { id: "asc" } });
  const execution = await tx.payoutExecution.findUniqueOrThrow({ where: { id: executionId } });
  let total = new D(0); let asset = PAYOUT_ASSET;
  for (const allocation of allocations) {
    const claimed = await tx.payableAllocation.updateMany({ where: { id: allocation.id, state: "ACTIVE" }, data: { state: to, closedAt: new Date() } });
    if (claimed.count !== 1) continue;
    const payable = allocation.payable; asset = payable.asset; total = total.plus(allocation.amount);
    const settled = to === "SETTLED" ? payable.settledAmount.plus(allocation.amount) : payable.settledAmount;
    const paid = to === "SETTLED" && settled.equals(payable.entitlement);
    await tx.customerPayable.update({ where: { id: payable.id }, data: { activeAmount: payable.activeAmount.minus(allocation.amount), settledAmount: settled, version: { increment: 1 },
      ...(paid ? { paymentStatus: "PAID", paidAt: new Date() } : {}) } });
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: execution.uidAccountId, asset: payable.asset } } });
    if (wallet.reserved.lessThan(allocation.amount)) throw new Error("WALLET_RESERVED_INVARIANT");
    await tx.wallet.update({ where: { id: wallet.id }, data: { reserved: wallet.reserved.minus(allocation.amount), ...(to === "SETTLED" ? { withdrawn: wallet.withdrawn.plus(allocation.amount) } : { available: wallet.available.plus(allocation.amount) }) } });
    await tx.walletEntry.create({ data: { walletId: wallet.id, type: to === "SETTLED" ? "WITHDRAWAL_SETTLE" : "WITHDRAWAL_RELEASE", amount: allocation.amount, sourceRef: allocation.id, opKey: `allocation:${allocation.id}:${to === "SETTLED" ? "settle" : "release"}`,
      balanceChanges: { reserved: allocation.amount.negated().toFixed(10), [to === "SETTLED" ? "withdrawn" : "available"]: allocation.amount.toFixed(10) } } });
  }
  void asset;
  return total;
}

async function clearPendingCorrectionIfIdle(tx: Tx, uidAccountId: string, asset: string) {
  if (!await tx.payoutExecution.findFirst({ where: { uidAccountId, asset, state: { in: [...IN_FLIGHT] } }, select: { id: true } }))
    await tx.payableSyncScope.updateMany({ where: { uidAccountId, asset, pendingCorrection: true }, data: { pendingCorrection: false } });
}

// ---------------------------------------------------------------------------------------------------------------
// Correction hooks, called from attribution (Req 22.20, 22.22, Req 8.7)
// ---------------------------------------------------------------------------------------------------------------

/** A correction before DISPATCHING voids the prepared execution and releases its money so the correction is netted first. */
export async function invalidateUndispatchedExecutions(tx: Tx, uidAccountId: string, asset: string, reason: string) {
  const prepared = await tx.payoutExecution.findMany({ where: { uidAccountId, asset, state: { in: ["AWAITING_APPROVAL", "READY"] } } });
  for (const execution of prepared) {
    await closeAllocations(tx, execution.id, "RELEASED");
    await tx.payoutExecution.update({ where: { id: execution.id }, data: { state: "INVALIDATED", failureCode: reason, blockers: [] } });
    await audit(tx, { uidAccountId, executionId: execution.id, kind: "EXECUTION_INVALIDATED", detail: { reason, total: execution.total.toFixed(10) } });
  }
  if (await tx.payoutExecution.findFirst({ where: { uidAccountId, asset, state: { in: [...IN_FLIGHT] } }, select: { id: true } }))
    await tx.payableSyncScope.upsert({ where: { uidAccountId_asset: { uidAccountId, asset } }, create: { uidAccountId, asset, sourceVersion: 1, state: "PENDING", pendingCorrection: true }, update: { pendingCorrection: true } });
}

/** Reduces the free entitlement newest-first. Money already reserved or paid is never rewritten: the wallet records a receivable instead. */
export async function reduceEntitlementForCorrection(tx: Tx, uidAccountId: string, asset: string, amount: Prisma.Decimal) {
  let remaining = amount;
  // A release that the sync job has not applied yet must exist before it can be reduced.
  const account = await tx.uidAccount.findUniqueOrThrow({ where: { id: uidAccountId } });
  const wallet = await tx.wallet.findUnique({ where: { uidAccountId_asset: { uidAccountId, asset } } });
  if (wallet) await createMissingPayables(tx, account.exchangeId, uidAccountId, asset, wallet.id);
  const payables = await tx.customerPayable.findMany({ where: { uidAccountId, asset, closedAt: null }, orderBy: [{ releasedAt: "desc" }, { id: "desc" }] });
  for (const payable of payables) {
    if (!remaining.greaterThan(0)) break;
    const take = D.min(remaining, free(payable)); if (!take.greaterThan(0)) continue;
    const entitlement = payable.entitlement.minus(take);
    const empty = entitlement.isZero() && payable.settledAmount.isZero() && payable.activeAmount.isZero();
    await tx.customerPayable.update({ where: { id: payable.id }, data: { entitlement, version: { increment: 1 }, ...(empty ? { closedAt: new Date() } : {}) } });
    await audit(tx, { uidAccountId, payableId: payable.id, kind: empty ? "PAYABLE_CLOSED_BY_CORRECTION" : "ENTITLEMENT_REDUCED", detail: { reduced: take.toFixed(10), entitlement: entitlement.toFixed(10) } });
    remaining = remaining.minus(take);
  }
  if (remaining.greaterThan(0)) await tx.payableSyncScope.upsert({ where: { uidAccountId_asset: { uidAccountId, asset } }, create: { uidAccountId, asset, sourceVersion: 1, state: "FAILED", invariantError: "CORRECTION_EXCEEDS_ENTITLEMENT" }, update: { state: "FAILED", invariantError: "CORRECTION_EXCEEDS_ENTITLEMENT" } });
  await markPayableSourceChanged(tx, uidAccountId, asset);
}

// ---------------------------------------------------------------------------------------------------------------
// Slot scheduler and run (Req 22.26-22.31, 22.36-22.38)
// ---------------------------------------------------------------------------------------------------------------

const SLOT_WINDOW_MS = 3_600_000;
export async function schedulePayoutSlot(now = new Date()) {
  const slot = currentSlotAt(now); const slotKey = slot.toISOString();
  return db.$transaction(async tx => {
    await lockCashback(tx);
    if (await tx.payoutSlot.findUnique({ where: { slotKey } })) return null;
    if (!mayDispatchNow(now, slot, SLOT_WINDOW_MS)) {
      // The window was missed: record it so nothing is ever dispatched late; the next 23:00 slot picks the money up (Req 22.28).
      if (await tx.payableSyncScope.count() || await tx.customerPayable.count()) await tx.payoutSlot.create({ data: { slotKey, cutoffAt: slot, state: "MISSED", finishedAt: now } });
      return null;
    }
    if (await tx.job.findFirst({ where: { type: "PAYOUT_SLOT", state: { in: ["PENDING", "CLAIMED"] }, payload: { path: ["slotKey"], equals: slotKey } }, select: { id: true } })) return null;
    return tx.job.create({ data: { type: "PAYOUT_SLOT", payload: { slotKey } } });
  });
}

type ManifestGroup = { uidAccountId: string; exchangeId: string; exchangeSlug: string; uid: string; payableIds: string[]; oldest: string };

async function buildManifest(tx: Tx, slotAt: Date): Promise<ManifestGroup[]> {
  const payables = await tx.customerPayable.findMany({ where: { asset: PAYOUT_ASSET, paymentStatus: "UNPAID", closedAt: null, releasedAt: { lte: slotAt } },
    include: { uidAccount: { include: { exchange: true } } }, orderBy: [{ releasedAt: "asc" }, { id: "asc" }] });
  const groups = new Map<string, ManifestGroup>();
  for (const payable of payables) {
    if (!free(payable).greaterThan(0)) continue;
    const slug = payable.uidAccount.exchange.slug;
    const group = groups.get(payable.uidAccountId) ?? { uidAccountId: payable.uidAccountId, exchangeId: payable.exchangeId, exchangeSlug: slug, uid: payable.uidAccount.uid, payableIds: [], oldest: payable.releasedAt.toISOString() };
    group.payableIds.push(payable.id); groups.set(payable.uidAccountId, group);
  }
  // Oldest released cashback first (approved ordering): deterministic, so replicas and replays see the same order.
  return [...groups.values()].sort((a, b) => a.oldest.localeCompare(b.oldest) || a.uidAccountId.localeCompare(b.uidAccountId));
}

export type GroupOutcome = { uidAccountId: string; uid: string; result: string; total?: string; blockers?: Blocker[] };

async function prepareGroup(lease: JobLease | null, group: ManifestGroup, slotKey: string, slotAt: Date): Promise<GroupOutcome> {
  const base = { uidAccountId: group.uidAccountId, uid: group.uid };
  const port = getInternalTransferPort(group.exchangeSlug);
  if (!(PAYOUT_EXCHANGES as readonly string[]).includes(group.exchangeSlug) || !port) return { ...base, result: "SKIPPED", blockers: ["CONFIG_MISSING"] };
  const recipient = await port.recipientStatus(group.uid).catch(() => "UNKNOWN" as const);
  return db.$transaction(async tx => {
    if (lease) await assertLease(tx, lease);
    await lockCashback(tx);
    await assertMoneyFlowMode(tx, ["PAYABLE_ONLY"]);
    const scope = await tx.payableSyncScope.findUnique({ where: { uidAccountId_asset: { uidAccountId: group.uidAccountId, asset: PAYOUT_ASSET } } });
    if (!scope || scope.state !== "SYNCED" || scope.sourceVersion !== scope.appliedVersion) return { ...base, result: "SKIPPED", blockers: [scope?.state === "FAILED" ? "SYNC_FAILED" : "SYNC_PENDING"] as Blocker[] };
    if (scope.pendingCorrection) return { ...base, result: "SKIPPED", blockers: ["CORRECTION_PENDING"] as Blocker[] };
    const wallet = await tx.wallet.findUnique({ where: { uidAccountId_asset: { uidAccountId: group.uidAccountId, asset: PAYOUT_ASSET } } });
    if (!wallet || wallet.receivable.greaterThan(0)) return { ...base, result: "SKIPPED", blockers: ["RECEIVABLE_OUTSTANDING"] as Blocker[] };
    if (recipient !== "READY") return { ...base, result: "SKIPPED", blockers: ["RECIPIENT_NOT_READY"] as Blocker[] };
    const existing = await tx.payoutExecution.findFirst({ where: { uidAccountId: group.uidAccountId, asset: PAYOUT_ASSET, state: { in: [...OPEN_STATES] } } });
    if (existing && (IN_FLIGHT as readonly string[]).includes(existing.state)) return { ...base, result: "SKIPPED", blockers: ["RECONCILIATION_REQUIRED"] as Blocker[] };
    const payables = await tx.customerPayable.findMany({ where: { id: { in: group.payableIds }, paymentStatus: "UNPAID", closedAt: null }, orderBy: [{ releasedAt: "asc" }, { id: "asc" }] });
    const newTotal = sum(payables.map(free));
    if (!newTotal.greaterThan(0)) return { ...base, result: "NOTHING_NEW", total: existing?.total.toFixed(10) };
    const projected = (existing?.total ?? new D(0)).plus(newTotal);
    const decision = decideExecution(projected.toFixed(10));
    if (decision === "MINIMUM_NOT_MET") return { ...base, result: "ACCUMULATING", total: projected.toFixed(10), blockers: ["MINIMUM_NOT_MET"] as Blocker[] };
    const requiresApproval = decision === "AWAITING_APPROVAL";
    const failed = existing ? null : await tx.payoutExecution.findFirst({ where: { uidAccountId: group.uidAccountId, asset: PAYOUT_ASSET, state: "FAILED_NOT_SENT" }, orderBy: { createdAt: "desc" } });
    const execution = existing ?? await tx.payoutExecution.create({ data: { uidAccountId: group.uidAccountId, exchangeId: group.exchangeId, asset: PAYOUT_ASSET, slotKey, total: newTotal, requiresApproval, state: requiresApproval ? "AWAITING_APPROVAL" : "READY",
      valuationMode: INTERNAL_USDT_POLICY.valuationMode, policyVersion: INTERNAL_USDT_POLICY.version, earliestSendAt: slotAt, previousExecutionId: failed?.id ?? null } });
    for (const payable of payables) await reserveAllocation(tx, execution, payable);
    if (existing) {
      const wasApproved = existing.approvedAt !== null;
      await tx.payoutExecution.update({ where: { id: existing.id }, data: { total: projected, requiresApproval, version: { increment: 1 }, state: requiresApproval ? "AWAITING_APPROVAL" : "READY",
        approvedBy: null, approvedAt: null, approvedVersion: null, approvedTotal: null, earliestSendAt: slotAt, blockers: [] } });
      await audit(tx, { uidAccountId: group.uidAccountId, executionId: existing.id, kind: "EXECUTION_MERGED", detail: { added: newTotal.toFixed(10), total: projected.toFixed(10), approvalVoided: wasApproved } });
    } else await audit(tx, { uidAccountId: group.uidAccountId, executionId: execution.id, kind: "EXECUTION_PREPARED", detail: { total: newTotal.toFixed(10), requiresApproval, slotKey } });
    return { ...base, result: existing ? "MERGED" : "PREPARED", total: projected.toFixed(10), blockers: requiresApproval ? ["AWAITING_APPROVAL"] as Blocker[] : [] };
  }, { timeout: 30000, maxWait: 10000 });
}

async function applyTransferOutcome(tx: Tx, executionId: string, outcome: TransferOutcome, actor: Actor = { type: "SYSTEM" }) {
  const execution = await tx.payoutExecution.findUniqueOrThrow({ where: { id: executionId } });
  if (!(IN_FLIGHT as readonly string[]).includes(execution.state)) return execution; // idempotent: a terminal execution is never settled or released twice
  const snapshot = (execution.snapshot ?? {}) as { toUid?: string; amount?: string };
  let next: Prisma.PayoutExecutionUpdateInput;
  if (outcome.outcome === "SUCCESS") {
    const matches = outcome.paidAmount !== undefined && new D(outcome.paidAmount).equals(execution.total) && outcome.toUid === snapshot.toUid && !!outcome.providerRef;
    if (!matches) {
      next = { state: "UNKNOWN", failureCode: "RECEIPT_MISMATCH", providerRef: outcome.providerRef ?? null };
      await audit(tx, { uidAccountId: execution.uidAccountId, executionId, kind: "RECEIPT_MISMATCH", actor, detail: { expected: execution.total.toFixed(10), paid: outcome.paidAmount ?? null, toUid: outcome.toUid ?? null } });
    } else {
      await closeAllocations(tx, executionId, "SETTLED");
      next = { state: "CONFIRMED", providerRef: outcome.providerRef, paidAmount: new D(outcome.paidAmount!), confirmedAt: new Date(), failureCode: null, blockers: [] };
      await audit(tx, { uidAccountId: execution.uidAccountId, executionId, kind: "EXECUTION_CONFIRMED", actor, detail: { providerRef: outcome.providerRef ?? null, paid: outcome.paidAmount ?? null } });
    }
  } else if (outcome.outcome === "NOT_SENT") {
    await closeAllocations(tx, executionId, "RELEASED");
    next = { state: "FAILED_NOT_SENT", failureCode: outcome.code ?? "NOT_SENT", blockers: [] };
    await audit(tx, { uidAccountId: execution.uidAccountId, executionId, kind: "EXECUTION_FAILED_NOT_SENT", actor, detail: { code: outcome.code ?? null } });
  } else if (outcome.outcome === "PENDING") {
    next = { state: "SUBMITTED", providerRef: outcome.providerRef ?? null };
    await audit(tx, { uidAccountId: execution.uidAccountId, executionId, kind: "EXECUTION_SUBMITTED", actor, detail: { providerRef: outcome.providerRef ?? null } });
  } else {
    next = { state: "UNKNOWN", failureCode: outcome.code ?? "UNKNOWN_RESULT" };
    await audit(tx, { uidAccountId: execution.uidAccountId, executionId, kind: "EXECUTION_UNKNOWN", actor, detail: { code: outcome.code ?? null } });
  }
  const updated = await tx.payoutExecution.update({ where: { id: executionId }, data: next });
  await clearPendingCorrectionIfIdle(tx, execution.uidAccountId, execution.asset);
  await markPayableSourceChanged(tx, execution.uidAccountId, execution.asset);
  return updated;
}

export type DispatchOutcome = { executionId: string; result: string; blockers?: Blocker[] };

async function dispatchExecution(lease: JobLease | null, executionId: string, slotKey: string, slotAt: Date, funds: Map<string, Prisma.Decimal>): Promise<DispatchOutcome> {
  const preview = await db.payoutExecution.findUniqueOrThrow({ where: { id: executionId }, include: { uidAccount: { include: { exchange: true } } } });
  const port = getInternalTransferPort(preview.uidAccount.exchange.slug);
  if (!port) return { executionId, result: "SKIPPED", blockers: ["CONFIG_MISSING"] };
  const principal = preview.total.toFixed(10);
  let fee: string;
  try { fee = await port.estimateFee(principal); } catch { return { executionId, result: "SKIPPED", blockers: ["FEE_NOT_READY"] }; }
  if (!funds.has(port.sourceAccountId)) {
    const balance = new D(await port.availableBalance());
    const inFlight = await db.payoutExecution.findMany({ where: { exchangeId: preview.exchangeId, state: { in: [...IN_FLIGHT] } } });
    funds.set(port.sourceAccountId, balance.minus(sum(inFlight.map(e => e.total))));
  }
  const need = new D(principal).plus(fee);
  if ((funds.get(port.sourceAccountId) ?? new D(0)).lessThan(need)) {
    // Insufficient funds (Req 22.37/22.38): never send a partial amount; keep UNPAID and look at the next group.
    await db.$transaction(async tx => {
      await lockCashback(tx);
      await tx.payoutExecution.updateMany({ where: { id: executionId, state: "READY" }, data: { blockers: ["INSUFFICIENT_SOURCE_FUNDS"], earliestSendAt: nextSlotAfter(slotAt) } });
      await audit(tx, { uidAccountId: preview.uidAccountId, executionId, kind: "INSUFFICIENT_SOURCE_FUNDS", detail: { need: need.toFixed(10), available: (funds.get(port.sourceAccountId) ?? new D(0)).toFixed(10) } });
    });
    return { executionId, result: "DEFERRED", blockers: ["INSUFFICIENT_SOURCE_FUNDS"] };
  }
  // Compare-and-set into DISPATCHING: only the winner may call the provider (Req 22.22).
  const claimed = await db.$transaction(async tx => {
    if (lease) await assertLease(tx, lease);
    await lockCashback(tx);
    if ((await readMoneyFlowMode(tx)) !== "PAYABLE_ONLY") return null;
    const current = await tx.payoutExecution.findUniqueOrThrow({ where: { id: executionId } });
    if (current.state !== "READY" || current.version !== preview.version || current.earliestSendAt > slotAt) return null;
    if (current.requiresApproval && !(current.approvedAt && approvalStillValid({ amount: current.approvedTotal!.toFixed(10), asset: current.asset, destination: preview.uidAccount.uid, payableVersion: current.approvedVersion! },
      { amount: current.total.toFixed(10), asset: current.asset, destination: preview.uidAccount.uid, payableVersion: current.version }))) return null;
    const scope = await tx.payableSyncScope.findUnique({ where: { uidAccountId_asset: { uidAccountId: current.uidAccountId, asset: current.asset } } });
    if (!scope || scope.state !== "SYNCED" || scope.sourceVersion !== scope.appliedVersion || scope.pendingCorrection) return null;
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: current.uidAccountId, asset: current.asset } } });
    if (wallet.receivable.greaterThan(0)) return null;
    const dispatchKey = `${slotKey}:${current.id}:${current.version}`;
    await tx.payoutExecution.update({ where: { id: current.id }, data: { state: "DISPATCHING", dispatchKey, sourceAccountId: port.sourceAccountId, dispatchedAt: new Date(), feeAmount: new D(fee), blockers: [],
      snapshot: { toUid: preview.uidAccount.uid, amount: principal, asset: current.asset, exchange: preview.uidAccount.exchange.slug, sourceAccountId: port.sourceAccountId, fee, valuationMode: current.valuationMode, policyVersion: current.policyVersion, version: current.version } } });
    await audit(tx, { uidAccountId: current.uidAccountId, executionId: current.id, kind: "EXECUTION_DISPATCHING", detail: { dispatchKey } });
    return dispatchKey;
  }, { timeout: 30000, maxWait: 10000 });
  if (!claimed) return { executionId, result: "NOT_ELIGIBLE" };
  funds.set(port.sourceAccountId, (funds.get(port.sourceAccountId) ?? new D(0)).minus(need));
  let outcome: TransferOutcome;
  try { outcome = await port.transfer({ dispatchKey: claimed, toUid: preview.uidAccount.uid, amount: principal }); }
  catch { outcome = { outcome: "UNKNOWN", code: "TRANSPORT_ERROR" }; } // a timeout never proves the money did not leave
  await db.$transaction(async tx => {
    if (lease) await assertLease(tx, lease);
    await lockCashback(tx);
    await applyTransferOutcome(tx, executionId, outcome);
  }, { timeout: 30000, maxWait: 10000 });
  return { executionId, result: outcome.outcome };
}

export type SlotSummary = { slotKey: string; state: string; groups: GroupOutcome[]; dispatched: DispatchOutcome[] };

/** One daily payout slot. Steps are idempotent so a redelivered or recovered job reuses the frozen manifest (Req 22.30). */
export async function runPayoutSlot(lease: JobLease, slotKey: string, options: { now?: Date } = {}): Promise<SlotSummary> {
  const now = options.now ?? new Date(); const slotAt = new Date(slotKey);
  if (!Number.isFinite(slotAt.getTime()) || slotAt.toISOString() !== slotKey || slotAt.getUTCHours() !== INTERNAL_USDT_POLICY.slotHourUtc) throw new Error("INVALID_SLOT_KEY");
  const started = await db.$transaction(async tx => {
    await assertLease(tx, lease); await lockCashback(tx);
    const row = await tx.payoutSlot.findUnique({ where: { slotKey } });
    if (row && row.state !== "RUNNING") return { skip: row.state };
    if (!mayDispatchNow(now, slotAt, SLOT_WINDOW_MS)) { // stale/recovered job: never send off-schedule (Req 22.28)
      await tx.payoutSlot.upsert({ where: { slotKey }, create: { slotKey, cutoffAt: slotAt, state: "MISSED", finishedAt: now }, update: { state: "MISSED", finishedAt: now } });
      return { skip: "MISSED" };
    }
    if ((await readMoneyFlowMode(tx)) !== "PAYABLE_ONLY") {
      await tx.payoutSlot.upsert({ where: { slotKey }, create: { slotKey, cutoffAt: slotAt, state: "BLOCKED", finishedAt: now }, update: { state: "BLOCKED", finishedAt: now } });
      return { skip: "BLOCKED" };
    }
    const manifest = row?.manifest ? row.manifest as unknown as ManifestGroup[] : await buildManifest(tx, slotAt);
    await tx.payoutSlot.upsert({ where: { slotKey }, create: { slotKey, cutoffAt: slotAt, state: "RUNNING", manifest: manifest as unknown as Prisma.InputJsonValue }, update: { manifest: manifest as unknown as Prisma.InputJsonValue } });
    return { manifest };
  });
  if ("skip" in started) { await completeJob(lease); return { slotKey, state: started.skip!, groups: [], dispatched: [] }; }
  const groups: GroupOutcome[] = [];
  for (const group of started.manifest!) groups.push(await prepareGroup(lease, group, slotKey, slotAt));
  // Dispatch: executions that are READY and allowed by the schedule, oldest released cashback first.
  const ready = await db.payoutExecution.findMany({ where: { state: "READY", earliestSendAt: { lte: slotAt }, asset: PAYOUT_ASSET }, include: { allocations: { include: { payable: true } } } });
  const oldest = (e: typeof ready[number]) => Math.min(...e.allocations.map(a => a.payable.releasedAt.getTime()), Number.MAX_SAFE_INTEGER);
  ready.sort((a, b) => oldest(a) - oldest(b) || a.id.localeCompare(b.id));
  const funds = new Map<string, Prisma.Decimal>(); const dispatched: DispatchOutcome[] = [];
  for (const execution of ready) dispatched.push(await dispatchExecution(lease, execution.id, slotKey, slotAt, funds));
  const summary = { groups, dispatched } as unknown as Prisma.InputJsonValue;
  await db.$transaction(async tx => {
    await assertLease(tx, lease);
    await tx.payoutSlot.update({ where: { slotKey }, data: { state: "DONE", finishedAt: new Date(), summary } });
  });
  await completeJob(lease);
  return { slotKey, state: "DONE", groups, dispatched };
}

// ---------------------------------------------------------------------------------------------------------------
// Reconciliation: independent of the schedule (Req 22.8, 22.28)
// ---------------------------------------------------------------------------------------------------------------

export async function scheduleReconcile() {
  return db.$transaction(async tx => {
    await lockCashback(tx);
    if (!await tx.payoutExecution.findFirst({ where: { state: { in: [...IN_FLIGHT] } }, select: { id: true } })) return null;
    if (await tx.job.findFirst({ where: { type: "PAYOUT_RECONCILE", state: "PENDING" }, select: { id: true } })) return null;
    return tx.job.create({ data: { type: "PAYOUT_RECONCILE", payload: {} } });
  });
}

async function lookupExecution(execution: PayoutExecution): Promise<TransferOutcome | null> {
  const snapshot = (execution.snapshot ?? {}) as { exchange?: string };
  const port = snapshot.exchange ? getInternalTransferPort(snapshot.exchange) : null;
  if (!port || !execution.dispatchKey) return null;
  try { return await port.lookup(execution.dispatchKey); } catch { return { outcome: "UNKNOWN", code: "LOOKUP_ERROR" }; }
}

export async function reconcileInFlight(lease: JobLease | null, options: { staleDispatchingMs?: number; now?: Date } = {}) {
  const now = options.now ?? new Date(); const stale = options.staleDispatchingMs ?? 300_000;
  const candidates = await db.payoutExecution.findMany({ where: { state: { in: [...IN_FLIGHT] } }, orderBy: { id: "asc" } });
  const results: Array<{ executionId: string; outcome: string }> = [];
  for (const execution of candidates) {
    if (execution.state === "DISPATCHING" && execution.dispatchedAt && now.getTime() - execution.dispatchedAt.getTime() < stale) continue;
    const outcome = await lookupExecution(execution);
    if (!outcome) continue;
    await db.$transaction(async tx => { if (lease) await assertLease(tx, lease); await lockCashback(tx); await applyTransferOutcome(tx, execution.id, outcome); }, { timeout: 30000, maxWait: 10000 });
    results.push({ executionId: execution.id, outcome: outcome.outcome });
  }
  return results;
}
export async function reconcileJob(lease: JobLease, options: { staleDispatchingMs?: number; now?: Date } = {}) {
  const results = await reconcileInFlight(lease, options);
  await completeJob(lease);
  return results;
}

// ---------------------------------------------------------------------------------------------------------------
// Admin commands: async, idempotent by commandKey (Req 22.19)
// ---------------------------------------------------------------------------------------------------------------

export type PayableCommandInput = { type: "APPROVE" | "CANCEL" | "RECONCILE" | "MARK_PAID"; executionId: string; commandKey: string; expectedVersion?: number; note?: string; reference?: string; amount?: string; toUid?: string };
const digestOf = (input: PayableCommandInput) => createHash("sha256").update(JSON.stringify([input.type, input.executionId, input.expectedVersion ?? null, input.reference ?? null, input.amount ?? null, input.toUid ?? null, input.note ?? null])).digest("hex");

export async function submitPayableCommand(adminId: string, input: PayableCommandInput) {
  if (!["APPROVE", "CANCEL", "RECONCILE", "MARK_PAID"].includes(input.type) || !/^[\w:.-]{8,100}$/.test(input.commandKey)) throw new PublicAccessError("INVALID_COMMAND", "Invalid payable command");
  const digest = digestOf(input);
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const existing = await tx.payableCommand.findUnique({ where: { commandKey: input.commandKey } });
    if (existing) {
      if (existing.payloadDigest !== digest) throw new PublicAccessError("COMMAND_KEY_REUSED", "commandKey was already used with a different payload", 409);
      return { commandId: existing.id, status: existing.status, replay: true };
    }
    const execution = await tx.payoutExecution.findUnique({ where: { id: input.executionId }, select: { id: true } });
    if (!execution) throw new PublicAccessError("EXECUTION_NOT_FOUND", "Payout execution not found", 404);
    const command = await tx.payableCommand.create({ data: { commandKey: input.commandKey, type: input.type, executionId: input.executionId, payloadDigest: digest, actorId: adminId } });
    await tx.job.create({ data: { type: "PAYABLE_COMMAND", payload: { commandId: command.id, input: { ...input } as unknown as Prisma.InputJsonObject } } });
    return { commandId: command.id, status: command.status, replay: false };
  });
}

async function finishCommand(tx: Tx, commandId: string, status: "DONE" | "REJECTED", result: Prisma.InputJsonValue) {
  await tx.payableCommand.update({ where: { id: commandId }, data: { status, result, finishedAt: new Date() } });
}

async function executeCommand(tx: Tx, commandId: string, adminId: string, input: PayableCommandInput, now: Date, lookup: TransferOutcome | null) {
  const reject = async (code: string) => { await finishCommand(tx, commandId, "REJECTED", { code }); return { status: "REJECTED" as const, code }; };
  const execution = await tx.payoutExecution.findUniqueOrThrow({ where: { id: input.executionId }, include: { uidAccount: true } });
  const actor: Actor = { type: "ADMIN", id: adminId };
  const scope = await tx.payableSyncScope.findUnique({ where: { uidAccountId_asset: { uidAccountId: execution.uidAccountId, asset: execution.asset } } });
  const blockers: Blocker[] = [];
  if ((IN_FLIGHT as readonly string[]).includes(execution.state)) blockers.push(execution.state === "UNKNOWN" ? "RECONCILIATION_REQUIRED" : "DISPATCHING");
  if (scope && (scope.state !== "SYNCED" || scope.sourceVersion !== scope.appliedVersion)) blockers.push(scope.state === "FAILED" ? "SYNC_FAILED" : "SYNC_PENDING");
  if (scope?.pendingCorrection) blockers.push("CORRECTION_PENDING");
  if (input.type === "APPROVE") {
    if (execution.state !== "AWAITING_APPROVAL") return reject("NOT_AWAITING_APPROVAL");
    if (input.expectedVersion !== execution.version) return reject("STALE_VERSION");
    if ((await readMoneyFlowMode(tx)) !== "PAYABLE_ONLY") return reject("MONEY_FLOW_CLOSED");
    if (!commandAllowed("APPROVE", blockers, true)) return reject("BLOCKED");
    // Approval never sends: the earliest dispatch is the next 23:00 UTC slot (Req 22.27).
    const earliest = nextSlotAfter(now);
    await tx.payoutExecution.update({ where: { id: execution.id }, data: { state: "READY", approvedBy: adminId, approvedAt: now, approvedVersion: execution.version, approvedTotal: execution.total, earliestSendAt: earliest, blockers: ["WAITING_SCHEDULE"] } });
    await audit(tx, { uidAccountId: execution.uidAccountId, executionId: execution.id, kind: "EXECUTION_APPROVED", actor, detail: { total: execution.total.toFixed(10), version: execution.version, earliestSendAt: earliest.toISOString(), note: input.note ?? null } });
    await finishCommand(tx, commandId, "DONE", { state: "READY", earliestSendAt: earliest.toISOString() });
    return { status: "DONE" as const };
  }
  if (input.type === "CANCEL") {
    if (!commandAllowed("CANCEL", blockers) || !["AWAITING_APPROVAL", "READY"].includes(execution.state)) return reject("CANNOT_CANCEL_AFTER_DISPATCH");
    await closeAllocations(tx, execution.id, "RELEASED");
    await tx.payoutExecution.update({ where: { id: execution.id }, data: { state: "CANCELLED", blockers: [] } });
    await audit(tx, { uidAccountId: execution.uidAccountId, executionId: execution.id, kind: "EXECUTION_CANCELLED", actor, detail: { note: input.note ?? null } });
    await markPayableSourceChanged(tx, execution.uidAccountId, execution.asset);
    await finishCommand(tx, commandId, "DONE", { state: "CANCELLED" });
    return { status: "DONE" as const };
  }
  if (input.type === "RECONCILE") {
    if (!commandAllowed("RECONCILE", blockers)) return reject("NOT_IN_FLIGHT");
    if (!lookup) return reject("NO_PROVIDER_EVIDENCE");
    await applyTransferOutcome(tx, execution.id, lookup, actor);
    await finishCommand(tx, commandId, "DONE", { outcome: lookup.outcome });
    return { status: "DONE" as const };
  }
  // MARK_PAID: manual payout. The execution must already be claimed (READY/in-flight) and the receipt must match it exactly.
  if (!["READY", "SUBMITTED", "UNKNOWN"].includes(execution.state)) return reject("NOT_CLAIMED");
  if (execution.state === "READY" && execution.requiresApproval && !execution.approvedAt) return reject("APPROVAL_REQUIRED");
  if (!input.reference?.trim()) return reject("REFERENCE_REQUIRED");
  if (blockers.some(b => ["SYNC_PENDING", "SYNC_FAILED", "CORRECTION_PENDING"].includes(b))) return reject("BLOCKED");
  if (await tx.payoutExecution.findFirst({ where: { providerRef: input.reference.trim(), id: { not: execution.id } }, select: { id: true } })) return reject("REFERENCE_REUSED");
  const matches = input.amount !== undefined && new D(input.amount).equals(execution.total) && input.toUid === execution.uidAccount.uid;
  if (execution.state === "READY") await tx.payoutExecution.update({ where: { id: execution.id }, data: { state: "DISPATCHING", sourceAccountId: "manual", dispatchedAt: now, dispatchKey: `manual:${execution.id}:${execution.version}`, snapshot: { toUid: execution.uidAccount.uid, amount: execution.total.toFixed(10), asset: execution.asset, exchange: "manual", version: execution.version } } });
  await applyTransferOutcome(tx, execution.id, { outcome: "SUCCESS", providerRef: input.reference.trim(), paidAmount: input.amount ?? "0", toUid: input.toUid ?? "" }, actor);
  const after = await tx.payoutExecution.findUniqueOrThrow({ where: { id: execution.id } });
  await finishCommand(tx, commandId, matches && after.state === "CONFIRMED" ? "DONE" : "REJECTED", { state: after.state, code: matches ? null : "RECEIPT_MISMATCH" });
  return { status: matches ? "DONE" as const : "REJECTED" as const };
}

export async function runPayableCommandJob(lease: JobLease, commandId: string, options: { now?: Date } = {}) {
  const command = await db.payableCommand.findUniqueOrThrow({ where: { id: commandId } });
  const job = await db.job.findUniqueOrThrow({ where: { id: lease.id } });
  const input = (job.payload as { input: PayableCommandInput }).input;
  if (command.status !== "ACCEPTED") { await completeJob(lease); return { status: command.status }; }
  let lookup: TransferOutcome | null = null;
  if (command.type === "RECONCILE") lookup = await lookupExecution(await db.payoutExecution.findUniqueOrThrow({ where: { id: command.executionId } }));
  return withJobLease(lease, async tx => {
    await lockCashback(tx);
    return executeCommand(tx, commandId, command.actorId, input, options.now ?? new Date(), lookup);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Read model for the admin ledger (Req 22.12): UNPAID with remaining > 0 by default, banner independent of filters
// ---------------------------------------------------------------------------------------------------------------

export function payableBlockers(input: { execution?: { state: string; requiresApproval: boolean; approvedAt: Date | null; earliestSendAt: Date; blockers: unknown } | null; scope?: { state: string; sourceVersion: number; appliedVersion: number; pendingCorrection: boolean } | null; receivable?: boolean; now?: Date; minimumNotMet?: boolean }): Blocker[] {
  const blockers: Blocker[] = []; const now = input.now ?? new Date(); const e = input.execution;
  if (e?.state === "UNKNOWN" || e?.state === "SUBMITTED") blockers.push("RECONCILIATION_REQUIRED");
  if (e?.state === "DISPATCHING") blockers.push("DISPATCHING");
  const s = input.scope;
  if (!s || s.state === "PENDING" || s.sourceVersion !== s.appliedVersion) blockers.push("SYNC_PENDING");
  if (s?.state === "FAILED") blockers.push("SYNC_FAILED");
  if (s?.pendingCorrection) blockers.push("CORRECTION_PENDING");
  if (input.receivable) blockers.push("RECEIVABLE_OUTSTANDING");
  if (e?.state === "AWAITING_APPROVAL") blockers.push("AWAITING_APPROVAL");
  if (e?.state === "READY" && e.earliestSendAt > now) blockers.push("WAITING_SCHEDULE");
  if (!e && !input.minimumNotMet) blockers.push("WAITING_SCHEDULE");
  if (input.minimumNotMet && !e) blockers.push("MINIMUM_NOT_MET");
  for (const code of Array.isArray(e?.blockers) ? e!.blockers as string[] : []) if (!blockers.includes(code as Blocker)) blockers.push(code as Blocker);
  return blockers;
}

export async function listPayables(filter: { exchangeId?: string; uid?: string; asset?: string; status?: "UNPAID" | "PAID" | "ALL"; includeClosed?: boolean; limit?: number } = {}) {
  const status = filter.status ?? "UNPAID"; const now = new Date();
  const where: Prisma.CustomerPayableWhereInput = { ...(filter.asset ? { asset: filter.asset } : {}), ...(filter.exchangeId ? { exchangeId: filter.exchangeId } : {}), ...(filter.uid ? { uidAccount: { uid: filter.uid } } : {}),
    ...(status === "ALL" ? {} : { paymentStatus: status }), ...(filter.includeClosed || status === "PAID" ? {} : { closedAt: null }) };
  const rows = await db.customerPayable.findMany({ where, include: { uidAccount: { include: { exchange: true } }, allocations: { where: { state: "ACTIVE" }, include: { execution: true } } }, orderBy: [{ releasedAt: "asc" }, { id: "asc" }], take: Math.min(filter.limit ?? 100, 500) });
  const scopes = await db.payableSyncScope.findMany();
  const scopeOf = new Map(scopes.map(scope => [`${scope.uidAccountId}:${scope.asset}`, scope]));
  const wallets = await db.wallet.findMany({ where: { receivable: { gt: 0 } }, select: { uidAccountId: true, asset: true } });
  const owes = new Set(wallets.map(w => `${w.uidAccountId}:${w.asset}`));
  const items = rows.map(row => {
    const remaining = row.entitlement.minus(row.settledAmount);
    const execution = row.allocations[0]?.execution ?? null;
    const blockers = row.paymentStatus === "PAID" ? [] : payableBlockers({ execution, scope: scopeOf.get(`${row.uidAccountId}:${row.asset}`), receivable: owes.has(`${row.uidAccountId}:${row.asset}`), now });
    return { id: row.id, exchange: row.uidAccount.exchange.slug, uid: row.uidAccount.uid, asset: row.asset, entitlement: row.entitlement.toFixed(10), settled: row.settledAmount.toFixed(10), remaining: remaining.toFixed(10),
      paymentStatus: row.paymentStatus, closed: row.closedAt !== null, releasedAt: row.releasedAt.toISOString(), executionId: execution?.id ?? null, executionState: execution?.state ?? null, primaryReason: row.paymentStatus === "PAID" ? null : primaryReason(blockers), blockers };
  }).filter(item => status !== "UNPAID" || new D(item.remaining).greaterThan(0));
  const totals: Record<string, string> = {};
  for (const item of items) if (item.paymentStatus === "UNPAID") totals[item.asset] = new D(totals[item.asset] ?? 0).plus(item.remaining).toFixed(10);
  // Banner: independent of the table filter, never hides what is not yet synced.
  const banner = {
    scopesNotSynced: scopes.filter(s => s.state !== "SYNCED" || s.sourceVersion !== s.appliedVersion).length,
    scopesFailed: scopes.filter(s => s.state === "FAILED").length,
    invariantErrors: scopes.filter(s => s.invariantError).length,
    pendingCorrection: scopes.filter(s => s.pendingCorrection).length,
    unknownExecutions: await db.payoutExecution.count({ where: { state: "UNKNOWN" } }),
    inFlightExecutions: await db.payoutExecution.count({ where: { state: { in: [...IN_FLIGHT] } } }),
    awaitingApproval: await db.payoutExecution.count({ where: { state: "AWAITING_APPROVAL" } }),
    failedJobs: await db.job.count({ where: { type: { in: ["SYNC_PAYABLES", "PAYOUT_SLOT", "PAYOUT_RECONCILE", "PAYABLE_COMMAND"] }, state: "FAILED" } }),
    totalsComplete: scopes.every(s => s.state === "SYNCED" && s.sourceVersion === s.appliedVersion)
  };
  return { items, totalsByAsset: banner.totalsComplete ? totals : null, partialTotalsByAsset: totals, banner };
}

export async function getExecution(id: string) {
  const execution = await db.payoutExecution.findUnique({ where: { id }, include: { allocations: true } });
  if (!execution) return null;
  const events = await db.payableEvent.findMany({ where: { executionId: id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { ...execution, events };
}
export const canSendNow = (blockers: Blocker[]) => canSend(blockers);

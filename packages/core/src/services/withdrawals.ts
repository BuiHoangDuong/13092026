import { createHash } from "node:crypto";
import { withdrawalCreateSchema, withdrawalDecisionSchema, payoutRoutesSchema, type PayoutRoutes } from "@cashback/contracts";
import { db, Prisma, type Withdrawal, type WithdrawalStatus } from "@cashback/db";
import { lockCashback } from "./jobs.js";
import { PublicAccessError } from "./rate-limit.js";
type Claimant = { uidAccountId: string; email: string };
const open: WithdrawalStatus[] = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "AUTO_APPROVED"];
export function payoutRoutes(): PayoutRoutes {
  try { return payoutRoutesSchema.parse(JSON.parse(process.env.WITHDRAWAL_ROUTES || "{}")); }
  catch { throw new PublicAccessError("CONFIGURATION_ERROR", "Withdrawals temporarily unavailable", 503); }
}
function threshold(asset: string): Prisma.Decimal | null {
  try {
    const values: unknown = JSON.parse(process.env.WITHDRAWAL_AUTO_APPROVE_THRESHOLDS || "{}");
    if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error();
    const value = (values as Record<string, unknown>)[asset];
    if (value === undefined) return null;
    if (typeof value !== "string" || !/^\d{1,20}(?:\.\d{1,10})?$/.test(value)) throw new Error();
    return new Prisma.Decimal(value);
  } catch { throw new PublicAccessError("CONFIGURATION_ERROR", "Withdrawals temporarily unavailable", 503); }
}
export function validPayoutAddress(network: string, address: string): boolean {
  if (network !== "TRON") return ["ETHEREUM", "BSC", "ARBITRUM", "OPTIMISM", "BASE"].includes(network) && /^0x[0-9a-fA-F]{40}$/.test(address) && !/^0x0{40}$/.test(address);
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return false;
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const char of address) number = number * 58n + BigInt(alphabet.indexOf(char));
  let hex = number.toString(16); if (hex.length % 2) hex = "0" + hex;
  const bytes = Buffer.from(hex, "hex");
  if (bytes.length !== 25 || bytes[0] !== 0x41 || bytes.subarray(1, 21).every(b => b === 0)) return false;
  const digest = createHash("sha256").update(createHash("sha256").update(bytes.subarray(0, 21)).digest()).digest();
  return bytes.subarray(21).equals(digest.subarray(0, 4));
}
const serialize = (w: Withdrawal & { uidAccount: { uid: string; exchangeId: string } }) => ({
  id: w.id, uidAccountId: w.uidAccountId, uid: w.uidAccount.uid, exchangeId: w.uidAccount.exchangeId, email: w.email,
  asset: w.asset, amount: w.amount.toFixed(10), network: w.network, address: w.address, status: w.status,
  isFirst: w.isFirst, payoutRef: w.payoutRef, createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString()
});
export async function requestWithdrawal(principal: Claimant, raw: unknown) {
  const input = withdrawalCreateSchema.parse(raw); const amount = new Prisma.Decimal(input.amount); const network = input.network.toUpperCase();
  if (!amount.greaterThan(0)) throw new PublicAccessError("INVALID_AMOUNT", "Amount must be positive");
  const routes = payoutRoutes();
  if (!Object.keys(routes).length) throw new PublicAccessError("CONFIGURATION_ERROR", "Withdrawals temporarily unavailable", 503);
  if (!routes[input.asset]?.some(n => n === network) || !validPayoutAddress(network, input.address)) throw new PublicAccessError("INVALID_DESTINATION", "Unsupported asset/network or invalid payout address");
  const cutoff = threshold(input.asset);
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const account = await tx.uidAccount.findUniqueOrThrow({ where: { id: principal.uidAccountId } });
    if (account.boundEmail !== principal.email) throw new PublicAccessError("FORBIDDEN", "Email verification required", 403);
    if (await tx.wallet.findFirst({ where: { uidAccountId: account.id, receivable: { gt: 0 } }, select: { id: true } })) throw new PublicAccessError("RECEIVABLE_OUTSTANDING", "A recovery adjustment must be cleared before withdrawing", 409);
    const wallet = await tx.wallet.findUnique({ where: { uidAccountId_asset: { uidAccountId: account.id, asset: input.asset } } });
    if (!wallet || amount.greaterThan(wallet.available)) throw new PublicAccessError("INSUFFICIENT_BALANCE", "Amount exceeds available cashback", 409);
    const isFirst = !await tx.withdrawal.findFirst({ where: { uidAccountId: account.id }, select: { id: true } });
    const status: WithdrawalStatus = isFirst || !cutoff || amount.greaterThan(cutoff) ? "UNDER_REVIEW" : "AUTO_APPROVED";
    const withdrawal = await tx.withdrawal.create({ data: { uidAccountId: account.id, email: principal.email, asset: input.asset, amount, network, address: input.address, isFirst } });
    await tx.wallet.update({ where: { id: wallet.id }, data: { available: wallet.available.minus(amount), reserved: wallet.reserved.plus(amount) } });
    await tx.walletEntry.create({ data: { walletId: wallet.id, type: "WITHDRAWAL_RESERVE", amount, sourceRef: withdrawal.id, opKey: `wd:${withdrawal.id}:reserve`, balanceChanges: { available: amount.negated().toFixed(10), reserved: amount.toFixed(10) } } });
    await tx.withdrawalEvent.createMany({ data: [
      { withdrawalId: withdrawal.id, fromStatus: null, toStatus: "REQUESTED", actorType: "CLAIMANT", actorId: account.id, email: principal.email },
      { withdrawalId: withdrawal.id, fromStatus: "REQUESTED", toStatus: status, actorType: "SYSTEM", email: principal.email }
    ] });
    return serialize(await tx.withdrawal.update({ where: { id: withdrawal.id }, data: { status }, include: { uidAccount: { select: { uid: true, exchangeId: true } } } }));
  }, { timeout: 30000, maxWait: 10000 });
}
async function transition(id: string, to: "APPROVED" | "PAID" | "REJECTED" | "CANCELLED", actor: { type: "CLAIMANT" | "ADMIN"; id: string }, note?: string, payoutRef?: string) {
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const withdrawal = await tx.withdrawal.findFirst({ where: { id, ...(actor.type === "CLAIMANT" ? { uidAccountId: actor.id } : {}) }, include: { uidAccount: { select: { uid: true, exchangeId: true } } } });
    if (!withdrawal) throw new PublicAccessError("WITHDRAWAL_NOT_FOUND", "Withdrawal not found", 404);
    if (withdrawal.status === to && (to !== "PAID" || withdrawal.payoutRef === payoutRef)) return serialize(withdrawal);
    if (!open.includes(withdrawal.status) || (to === "APPROVED" && withdrawal.status !== "UNDER_REVIEW") || (to === "PAID" && !["APPROVED", "AUTO_APPROVED"].includes(withdrawal.status))) throw new PublicAccessError("INVALID_TRANSITION", "Withdrawal cannot enter this state", 409);
    if (to === "PAID" && !payoutRef?.trim()) throw new PublicAccessError("INVALID_REFERENCE", "Payout reference is required");
    if (to !== "APPROVED") {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { uidAccountId_asset: { uidAccountId: withdrawal.uidAccountId, asset: withdrawal.asset } } });
      if (wallet.reserved.lessThan(withdrawal.amount)) throw new Error("Reserved balance invariant failed");
      const settle = to === "PAID"; const amount = withdrawal.amount;
      await tx.wallet.update({ where: { id: wallet.id }, data: { reserved: wallet.reserved.minus(amount), ...(settle ? { withdrawn: wallet.withdrawn.plus(amount) } : { available: wallet.available.plus(amount) }) } });
      await tx.walletEntry.create({ data: { walletId: wallet.id, type: settle ? "WITHDRAWAL_SETTLE" : "WITHDRAWAL_RELEASE", amount, sourceRef: id, opKey: `wd:${id}:${settle ? "settle" : "release"}`, balanceChanges: { reserved: amount.negated().toFixed(10), [settle ? "withdrawn" : "available"]: amount.toFixed(10) } } });
    }
    await tx.withdrawalEvent.create({ data: { withdrawalId: id, fromStatus: withdrawal.status, toStatus: to, actorType: actor.type, actorId: actor.id, email: withdrawal.email, note, reference: payoutRef } });
    return serialize(await tx.withdrawal.update({ where: { id }, data: { status: to, ...(to === "PAID" ? { payoutRef } : {}) }, include: { uidAccount: { select: { uid: true, exchangeId: true } } } }));
  }, { timeout: 30000, maxWait: 10000 });
}
export const cancelWithdrawal = (uidAccountId: string, id: string) => transition(id, "CANCELLED", { type: "CLAIMANT", id: uidAccountId });
export function decideWithdrawal(adminId: string, id: string, raw: unknown) {
  const input = withdrawalDecisionSchema.parse(raw);
  return transition(id, input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "PAID", { type: "ADMIN", id: adminId }, input.note, input.payoutRef);
}
export async function listWithdrawals(uidAccountId?: string, cursor?: string) {
  const where: Prisma.WithdrawalWhereInput = uidAccountId ? { uidAccountId } : { status: { in: open } };
  return db.$transaction(async tx => {
    if (cursor && !await tx.withdrawal.findFirst({ where: { id: cursor, ...(uidAccountId ? { uidAccountId } : {}) }, select: { id: true } })) throw new PublicAccessError("INVALID_CURSOR", "Invalid withdrawal history cursor");
    const rows = await tx.withdrawal.findMany({ where, include: { uidAccount: { select: { uid: true, exchangeId: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 26, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    return { withdrawals: rows.slice(0, 25).map(serialize), nextCursor: rows.length > 25 ? rows[24]!.id : null };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

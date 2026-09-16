import type { UidLinksResponse, WalletResponse } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { lockCashback, withJobLease, type JobLease } from "./jobs.js";

export class CashbackError extends Error {
  constructor(public readonly code: "INVALID_UID_LINK" | "UID_NOT_FOUND" | "UID_CONFLICT", message: string) { super(message); }
}

export async function createUidLink(customerId: string, input: { exchangeId: string; uid: string; referralLinkId?: string }) {
  if (!/^\d{1,128}$/.test(input.uid)) throw new CashbackError("INVALID_UID_LINK", "Enter your Bybit UID as digits, preserving any leading zeros");
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const exchange = await tx.exchange.findFirst({ where: { id: input.exchangeId, slug: "bybit", status: "PUBLISHED" } });
    if (!exchange) throw new CashbackError("INVALID_UID_LINK", "Bybit UID linking is currently supported");
    if (input.referralLinkId && !await tx.referralLink.findFirst({ where: { id: input.referralLinkId, exchangeId: input.exchangeId, active: true } })) {
      throw new CashbackError("INVALID_UID_LINK", "Referral link does not belong to this exchange");
    }
    const existing = await tx.uidLink.findFirst({ where: { customerId, exchangeId: input.exchangeId, uid: input.uid } });
    if (existing) return { id: existing.id, status: existing.status };
    const owner = await tx.uidLink.findFirst({ where: { exchangeId: input.exchangeId, uid: input.uid, status: "VERIFIED" } });
    const link = await tx.uidLink.create({ data: { customerId, ...input,
      status: owner ? "REJECTED" : "PENDING_VERIFICATION", flaggedForReview: Boolean(owner)
    } });
    return { id: link.id, status: link.status };
  });
}

export async function listUidLinks(customerId: string): Promise<UidLinksResponse> {
  const links = await db.uidLink.findMany({ where: { customerId }, orderBy: { createdAt: "asc" } });
  const exchanges = await db.exchange.findMany({ where: { id: { in: links.map(link => link.exchangeId) } }, select: { id: true, name: true } });
  return { links: links.map(link => ({ id: link.id, exchangeId: link.exchangeId,
    exchangeName: exchanges.find(exchange => exchange.id === link.exchangeId)?.name ?? "Exchange",
    uid: link.uid, status: link.status, ownershipApproved: Boolean(link.ownershipApprovedAt), verifiedAt: link.verifiedAt?.toISOString() ?? null
  })) };
}

export async function listPendingUidLinks() {
  return db.uidLink.findMany({ where: { status: "PENDING_VERIFICATION" }, orderBy: { createdAt: "asc" }, take: 100,
    select: { id: true, uid: true, exchangeId: true, ownershipApprovedAt: true, createdAt: true, customer: { select: { email: true } } } });
}

export async function approveUidOwnership(id: string, adminId: string, note: string) {
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const link = await tx.uidLink.findUnique({ where: { id } });
    if (!link) throw new CashbackError("UID_NOT_FOUND", "UID link not found");
    if (link.status !== "PENDING_VERIFICATION") throw new CashbackError("UID_CONFLICT", "Only pending UID links can be approved");
    const owner = await tx.uidLink.findFirst({ where: { exchangeId: link.exchangeId, uid: link.uid, status: "VERIFIED", customerId: { not: link.customerId } } });
    if (owner) throw new CashbackError("UID_CONFLICT", "UID ownership requires review");
    await tx.uidLink.update({ where: { id }, data: { ownershipApprovedAt: new Date(), ownershipNote: `${adminId}: ${note}` } });
    await tx.job.create({ data: { type: "ATTRIBUTE", payload: { exchangeId: link.exchangeId } } });
    return { ok: true };
  });
}

export function holdingHours(): number | null {
  const value = process.env.HOLDING_PERIOD_HOURS;
  if (value === undefined || value.trim() === "") return null;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 0 || hours > 8760) throw new Error("HOLDING_PERIOD_HOURS must be between 0 and 8760");
  return hours;
}

export function cashbackTarget(commission: Prisma.Decimal, rate: Prisma.Decimal) {
  if (commission.isNegative() || rate.isNegative() || rate.greaterThan(1)) throw new Error("Invalid cashback amount/rate");
  return commission.times(rate).toDecimalPlaces(10, Prisma.Decimal.ROUND_DOWN);
}

async function verifyApprovedUids(tx: Prisma.TransactionClient, exchangeId: string) {
  const pending = await tx.uidLink.findMany({ where: { exchangeId, status: "PENDING_VERIFICATION", ownershipApprovedAt: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  for (const link of pending) {
    const owner = await tx.uidLink.findFirst({ where: { exchangeId, uid: link.uid, status: "VERIFIED" } });
    if (owner && owner.customerId !== link.customerId) {
      await tx.uidLink.update({ where: { id: link.id }, data: { status: "REJECTED", flaggedForReview: true } });
      continue;
    }
    const evidence = await tx.commissionRecord.findFirst({ where: { exchangeId, uid: link.uid, activeVersion: { batch: { status: "PUBLISHED" } } } });
    if (!evidence) continue;
    await tx.uidLink.update({ where: { id: link.id }, data: { status: "VERIFIED", verifiedAt: new Date() } });
    await tx.uidLink.updateMany({ where: { exchangeId, uid: link.uid, customerId: { not: link.customerId }, status: "PENDING_VERIFICATION" }, data: { status: "REJECTED", flaggedForReview: true } });
  }
}

async function attributeExchange(tx: Prisma.TransactionClient, exchangeId: string) {
  await verifyApprovedUids(tx, exchangeId);
  const exchange = await tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
  const records = await tx.commissionRecord.findMany({ where: { exchangeId, activeVersion: { batch: { status: "PUBLISHED" } } }, include: { activeVersion: true }, orderBy: { id: "asc" } });
  const hours = holdingHours();
  for (const record of records) {
    const owner = await tx.uidLink.findFirst({ where: { exchangeId, uid: record.uid, status: "VERIFIED" } });
    if (!owner || !record.activeVersion) continue;
    if (record.attributedCustomerId && record.attributedCustomerId !== owner.customerId) throw new Error("Attribution owner cannot change automatically");
    const opKey = `attr:${record.activeVersion.id}`;
    if (await tx.walletEntry.findUnique({ where: { opKey } })) continue;
    let rate = record.cashbackRate, offerId = record.offerId;
    if (!rate) {
      rate = exchange.defaultCashbackRate;
      // The customer-entered link alone is never sufficient for an offer override.
      const reportedLink = record.activeVersion.referralLinkId;
      if (reportedLink && reportedLink === owner.referralLinkId) {
        const link = await tx.referralLink.findFirst({ where: { id: reportedLink, exchangeId }, include: { offer: true } });
        if (link?.offer && link.offer.exchangeId === exchangeId) { rate = link.offer.cashbackRate; offerId = link.offer.id; }
      }
    }
    if (!rate) continue;
    const target = cashbackTarget(record.reconciledAmount, rate);
    const delta = target.minus(record.creditedCashback);
    const wallet = await tx.wallet.upsert({ where: { customerId_asset: { customerId: owner.customerId, asset: record.asset } },
      update: {}, create: { customerId: owner.customerId, asset: record.asset } });
    let pending = wallet.pending, available = wallet.available, receivable = wallet.receivable;
    let remainingPending = new Prisma.Decimal(0);
    let type: "CREDIT" | "REVERSAL" | "CLAWBACK" | "ADJUSTMENT" = "ADJUSTMENT";
    if (delta.greaterThan(0)) {
      const offset = Prisma.Decimal.min(delta, receivable);
      receivable = receivable.minus(offset);
      remainingPending = delta.minus(offset);
      pending = pending.plus(remainingPending);
      type = "CREDIT";
    } else if (delta.lessThan(0)) {
      let deduction = delta.negated();
      const credits = await tx.walletEntry.findMany({ where: { walletId: wallet.id, remainingPending: { gt: 0 } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
      for (const credit of credits) {
        const taken = Prisma.Decimal.min(deduction, credit.remainingPending);
        await tx.walletEntry.update({ where: { id: credit.id }, data: { remainingPending: credit.remainingPending.minus(taken) } });
        pending = pending.minus(taken); deduction = deduction.minus(taken);
        if (deduction.isZero()) break;
      }
      const fromAvailable = Prisma.Decimal.min(deduction, available);
      available = available.minus(fromAvailable); deduction = deduction.minus(fromAvailable);
      receivable = receivable.plus(deduction);
      type = deduction.greaterThan(0) ? "CLAWBACK" : "REVERSAL";
    }
    await tx.wallet.update({ where: { id: wallet.id }, data: { pending, available, receivable } });
    await tx.walletEntry.create({ data: { walletId: wallet.id, type, amount: delta, remainingPending, sourceRef: record.activeVersion.id, opKey,
      balanceChanges: { pending: pending.minus(wallet.pending).toFixed(10), available: available.minus(wallet.available).toFixed(10), receivable: receivable.minus(wallet.receivable).toFixed(10) },
      availableAt: remainingPending.greaterThan(0) && hours !== null ? new Date(Date.now() + hours * 3_600_000) : null } });
    await tx.commissionRecord.update({ where: { id: record.id }, data: { attributedCustomerId: owner.customerId, cashbackRate: rate, offerId, creditedCashback: target } });
  }
}

export async function attributeJob(lease: JobLease, exchangeId: string) {
  return withJobLease(lease, async tx => { await lockCashback(tx); await attributeExchange(tx, exchangeId); });
}

export async function releaseHoldsJob(lease: JobLease) {
  return withJobLease(lease, async tx => {
    await lockCashback(tx);
    const hours = holdingHours();
    if (hours === null) return;
    const credits = await tx.walletEntry.findMany({ where: { type: "CREDIT", remainingPending: { gt: 0 } }, orderBy: { id: "asc" } });
    for (const credit of credits) {
      const due = credit.availableAt ?? new Date(credit.createdAt.getTime() + hours * 3_600_000);
      if (due > new Date()) continue;
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: credit.walletId } });
      const amount = credit.remainingPending;
      await tx.wallet.update({ where: { id: wallet.id }, data: { pending: wallet.pending.minus(amount), available: wallet.available.plus(amount) } });
      await tx.walletEntry.update({ where: { id: credit.id }, data: { remainingPending: 0, availableAt: due } });
      await tx.walletEntry.create({ data: { walletId: wallet.id, type: "HOLD_RELEASE", amount, sourceRef: credit.id, opKey: `release:${credit.id}`,
        balanceChanges: { pending: amount.negated().toFixed(10), available: amount.toFixed(10) } } });
    }
  });
}

export async function scheduleHoldRelease() {
  if (holdingHours() === null) return;
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const pending = await tx.job.findFirst({ where: { type: "RELEASE_HOLDS", state: { in: ["PENDING", "CLAIMED"] } } });
    if (!pending) await tx.job.create({ data: { type: "RELEASE_HOLDS", payload: {} } });
  });
}

export async function getWallet(customerId: string, cursor?: string): Promise<WalletResponse> {
  return db.$transaction(async tx => {
    const wallets = await tx.wallet.findMany({ where: { customerId }, orderBy: { asset: "asc" } });
    if (cursor && !await tx.walletEntry.findFirst({ where: { id: cursor, wallet: { customerId } } })) throw new CashbackError("INVALID_UID_LINK", "Invalid history cursor");
    const entries = await tx.walletEntry.findMany({ where: { wallet: { customerId } }, include: { wallet: { select: { asset: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const record = await tx.commissionRecord.findFirst({ where: { attributedCustomerId: customerId }, select: { id: true } });
    const applied = await tx.$queryRaw<Array<{ publishedAt: Date | null; sourceAsOf: Date | null }>>(Prisma.sql`
      SELECT b."publishedAt", b."sourceAsOf" FROM "WalletEntry" e
      JOIN "Wallet" w ON w.id = e."walletId"
      JOIN "CommissionVersion" v ON v.id = e."sourceRef"
      JOIN "ImportBatch" b ON b.id = v."batchId"
      WHERE w."customerId" = ${customerId} ORDER BY b."publishedAt" DESC NULLS LAST LIMIT 1
    `);
    const batch = applied[0];
    return {
      balances: wallets.map(wallet => ({ asset: wallet.asset, pending: wallet.pending.toFixed(10), available: wallet.available.toFixed(10), reserved: wallet.reserved.toFixed(10), withdrawn: wallet.withdrawn.toFixed(10), receivable: wallet.receivable.toFixed(10) })),
      hasData: Boolean(record), lastImportAt: batch?.publishedAt?.toISOString() ?? null, sourceAsOf: batch?.sourceAsOf?.toISOString() ?? null,
      history: entries.slice(0, 50).map(entry => ({ id: entry.id, type: entry.type, asset: entry.wallet.asset, amount: entry.amount.toFixed(10), createdAt: entry.createdAt.toISOString(), availableAt: entry.availableAt?.toISOString() ?? null })),
      nextCursor: entries.length > 50 ? entries[49]!.id : null
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

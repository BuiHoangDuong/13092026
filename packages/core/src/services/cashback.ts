import type { WalletResponse } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { lockCashback, withJobLease, type JobLease } from "./jobs.js";

export class CashbackError extends Error {
  constructor(public readonly code: "INVALID_HISTORY_CURSOR", message: string) { super(message); }
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

export async function upsertUidAccount(tx: Prisma.TransactionClient, exchangeId: string, uid: string) {
  return tx.uidAccount.upsert({ where: { exchangeId_uid: { exchangeId, uid } }, update: {}, create: { exchangeId, uid } });
}

async function attributeExchange(tx: Prisma.TransactionClient, exchangeId: string) {
  const exchange = await tx.exchange.findUniqueOrThrow({ where: { id: exchangeId } });
  const records = await tx.commissionRecord.findMany({ where: { exchangeId, activeVersion: { batch: { status: "PUBLISHED" } } }, include: { activeVersion: true }, orderBy: { id: "asc" } });
  const hours = holdingHours();
  for (const record of records) {
    const owner = await upsertUidAccount(tx, exchangeId, record.uid);
    if (!record.activeVersion) continue;
    if (record.attributedUidAccountId && record.attributedUidAccountId !== owner.id) throw new Error("Attribution owner cannot change automatically");
    const opKey = `attr:${record.activeVersion.id}`;
    if (await tx.walletEntry.findUnique({ where: { opKey } })) continue;
    let rate = record.cashbackRate, offerId = record.offerId;
    if (!rate) {
      rate = exchange.defaultCashbackRate;
      // Only referral evidence from the published report can select an offer.
      const reportedLink = record.activeVersion.referralLinkId;
      if (reportedLink) {
        const link = await tx.referralLink.findFirst({ where: { id: reportedLink, exchangeId }, include: { offer: true } });
        if (link?.offer && link.offer.exchangeId === exchangeId) { rate = link.offer.cashbackRate; offerId = link.offer.id; }
      }
    }
    if (!rate) continue;
    const target = cashbackTarget(record.reconciledAmount, rate);
    const delta = target.minus(record.creditedCashback);
    const wallet = await tx.wallet.upsert({ where: { uidAccountId_asset: { uidAccountId: owner.id, asset: record.asset } },
      update: {}, create: { uidAccountId: owner.id, asset: record.asset } });
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
    await tx.commissionRecord.update({ where: { id: record.id }, data: { attributedUidAccountId: owner.id, cashbackRate: rate, offerId, creditedCashback: target } });
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

export async function getWallet(uidAccountId: string, cursor?: string): Promise<WalletResponse> {
  return db.$transaction(async tx => {
    const wallets = await tx.wallet.findMany({ where: { uidAccountId }, orderBy: { asset: "asc" } });
    if (cursor && !await tx.walletEntry.findFirst({ where: { id: cursor, wallet: { uidAccountId } } })) throw new CashbackError("INVALID_HISTORY_CURSOR", "Invalid history cursor");
    const entries = await tx.walletEntry.findMany({ where: { wallet: { uidAccountId } }, include: { wallet: { select: { asset: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    const record = await tx.commissionRecord.findFirst({ where: { attributedUidAccountId: uidAccountId }, select: { id: true } });
    const applied = await tx.$queryRaw<Array<{ publishedAt: Date | null; sourceAsOf: Date | null }>>(Prisma.sql`
      SELECT b."publishedAt", b."sourceAsOf" FROM "WalletEntry" e
      JOIN "Wallet" w ON w.id = e."walletId"
      JOIN "CommissionVersion" v ON v.id = e."sourceRef"
      JOIN "ImportBatch" b ON b.id = v."batchId"
      WHERE w."uidAccountId" = ${uidAccountId} ORDER BY b."publishedAt" DESC NULLS LAST LIMIT 1
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

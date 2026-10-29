import { lookupRequestSchema, lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { consumeBudget, positiveConfig } from "./rate-limit.js";

const transactionCap = 100;

export async function latestReportedDay(tx: Pick<Prisma.TransactionClient, "$queryRaw">, exchangeId: string, now: Date): Promise<Date | null> {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await tx.$queryRaw<Array<{ day: Date }>>(Prisma.sql`
    SELECT MAX(candidate.day) AS day FROM "ImportBatch" b
    CROSS JOIN LATERAL (SELECT LEAST(${today}::timestamp, date_trunc('day', b."periodEnd" + INTERVAL '1 millisecond')) - INTERVAL '1 day' AS day) candidate
    WHERE b."exchangeId" = ${exchangeId} AND b."datasetKind" = 'COMMISSION' AND b.status = 'PUBLISHED'
      AND (b."sourceAsOf" IS NULL OR b."sourceAsOf" >= b."periodEnd")
      AND (b."periodEnd" - b."periodStart" <= INTERVAL '1 day' OR b."reportType" = 'TRANSACTION')
      AND b."periodStart" <= candidate.day AND b."periodEnd" + INTERVAL '1 millisecond' >= candidate.day + INTERVAL '1 day'
  `);
  return rows[0]?.day ?? null;
}

type CashbackPeriod = { periodStart: Date; periodEnd: Date; creditedCashback: Prisma.Decimal };
/** Source periods use inclusive ends; never distribute a multi-day amount across days. */
export function summarizePublishedCashback(records: CashbackPeriod[], start: Date, end: Date, covered = false) {
  if (!covered) return { status: "NO_DATA" as const, amount: null };
  const overlap = records.filter(row => row.periodStart < end && row.periodEnd >= start);
  if (overlap.some(row => row.periodStart < start || row.periodEnd >= end)) {
    return { status: "INSUFFICIENT_DETAIL" as const, amount: null };
  }
  return { status: "REPORTED" as const, amount: overlap.reduce((sum, row) => sum.plus(row.creditedCashback), new Prisma.Decimal(0)).toFixed(10) };
}

export async function lookupCashback(raw: unknown, ip: string): Promise<LookupResponse> {
  const { exchangeId, uid } = lookupRequestSchema.parse(raw);
  await consumeBudget("lookup:ip", ip, [
    { seconds: 60, limit: positiveConfig("LOOKUP_RATE_PER_MINUTE", 5) },
    { seconds: 3600, limit: positiveConfig("LOOKUP_RATE_PER_HOUR", 30) }
  ]);
  const now = new Date();
  return db.$transaction(async tx => {
    const dayStart = await latestReportedDay(tx, exchangeId, now);
    const end = dayStart ? new Date(dayStart.getTime() + 86_400_000) : null;
    const rollingStart = dayStart ? new Date(dayStart.getTime() - 29 * 86_400_000) : null;
    const summaryPeriods = { reportDay: dayStart?.toISOString().slice(0, 10) ?? null, end: end?.toISOString() ?? null, rollingStart: rollingStart?.toISOString() ?? null };
    const empty = { balances: [], summaryPeriods, hasData: false, hasMore: false, lastImportAt: null, sourceAsOf: null, transactions: [] };
    const account = await tx.uidAccount.findUnique({ where: { exchangeId_uid: { exchangeId, uid } }, select: { id: true } });
    if (!account) return lookupResponseSchema.parse(empty);
    const attributed = await tx.commissionRecord.findFirst({ where: { attributedUidAccountId: account.id }, select: { id: true } });
    if (!attributed) return lookupResponseSchema.parse(empty);
    const [wallets, records, summaryRecords, applied] = await Promise.all([
      tx.wallet.findMany({ where: { uidAccountId: account.id }, orderBy: { asset: "asc" }, select: { asset: true, withdrawn: true } }),
      tx.commissionRecord.findMany({
        where: { attributedUidAccountId: account.id },
        orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
        take: transactionCap + 1,
        select: { id: true, asset: true, periodStart: true, periodEnd: true, creditedCashback: true }
      }),
      end && rollingStart ? tx.commissionRecord.findMany({
        where: { attributedUidAccountId: account.id, periodStart: { lt: end }, periodEnd: { gte: rollingStart } },
        select: { asset: true, periodStart: true, periodEnd: true, creditedCashback: true }
      }) : Promise.resolve([]),
      tx.$queryRaw<Array<{ publishedAt: Date | null; sourceAsOf: Date | null }>>(Prisma.sql`
        SELECT b."publishedAt", b."sourceAsOf" FROM "WalletEntry" e
        JOIN "Wallet" w ON w.id = e."walletId"
        JOIN "CommissionVersion" v ON v.id = e."sourceRef"
        JOIN "ImportBatch" b ON b.id = v."batchId"
        WHERE w."uidAccountId" = ${account.id} ORDER BY b."publishedAt" DESC NULLS LAST LIMIT 1
      `)
    ]);
    const hasMore = records.length > transactionCap;
    const page = hasMore ? records.slice(0, transactionCap) : records;
    const assets = [...new Set([...wallets.map(w => w.asset), ...page.map(row => row.asset), ...summaryRecords.map(row => row.asset)])].sort();
    return lookupResponseSchema.parse({
      summaryPeriods,
      balances: assets.map(asset => ({ asset,
        totalPaid: (wallets.find(w => w.asset === asset)?.withdrawn ?? new Prisma.Decimal(0)).toFixed(10),
        previousDay: summarizePublishedCashback(summaryRecords.filter(row => row.asset === asset), dayStart ?? now, end ?? now, dayStart !== null),
        rolling30Days: summarizePublishedCashback(summaryRecords.filter(row => row.asset === asset), rollingStart ?? now, end ?? now, dayStart !== null)
      })),
      hasData: true, hasMore, lastImportAt: applied[0]?.publishedAt?.toISOString() ?? null, sourceAsOf: applied[0]?.sourceAsOf?.toISOString() ?? null,
      transactions: page.map(row => ({
        id: row.id,
        asset: row.asset,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        uid,
        cashback: row.creditedCashback.toFixed(10)
      }))
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

import { lookupRequestSchema, lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { consumeBudget, positiveConfig } from "./rate-limit.js";

const attributionTypes = ["CREDIT", "REVERSAL", "CLAWBACK", "ADJUSTMENT"] as const;
const transactionCap = 100;

type CreditedVersion = { id: string; commissionId: string; amount: Prisma.Decimal; importedAt: Date };
type CreditedEntry = { sourceRef: string | null };

/** Latest applied version per record. Match `WalletEntry.sourceRef` to the version id — do not parse `opKey`. */
export function creditedCommissionByRecord(versions: CreditedVersion[], entries: CreditedEntry[]) {
  const appliedIds = new Set(entries.flatMap(entry => entry.sourceRef ? [entry.sourceRef] : []));
  const latest = new Map<string, CreditedVersion>();
  for (const version of versions) {
    if (!appliedIds.has(version.id)) continue;
    const current = latest.get(version.commissionId);
    const newer = !current || version.importedAt > current.importedAt || (version.importedAt.getTime() === current.importedAt.getTime() && version.id > current.id);
    if (newer) latest.set(version.commissionId, version);
  }
  return new Map([...latest].map(([commissionId, version]) => [commissionId, version.amount]));
}

/** No applied wallet entry means commission 0. Never surface in-flight `reconciledAmount`. */
export function commissionForLookup(credited: Prisma.Decimal | undefined) {
  return credited ?? new Prisma.Decimal(0);
}

export async function lookupCashback(raw: unknown, ip: string): Promise<LookupResponse> {
  const { exchangeId, uid } = lookupRequestSchema.parse(raw);
  await consumeBudget("lookup:ip", ip, [
    { seconds: 60, limit: positiveConfig("LOOKUP_RATE_PER_MINUTE", 5) },
    { seconds: 3600, limit: positiveConfig("LOOKUP_RATE_PER_HOUR", 30) }
  ]);
  return db.$transaction(async tx => {
    const account = await tx.uidAccount.findUnique({ where: { exchangeId_uid: { exchangeId, uid } }, select: { id: true } });
    if (!account) return { balances: [], hasData: false, hasMore: false, lastImportAt: null, sourceAsOf: null, transactions: [] };
    const [wallets, records, applied] = await Promise.all([
      tx.wallet.findMany({ where: { uidAccountId: account.id }, orderBy: { asset: "asc" }, select: { asset: true, pending: true, available: true } }),
      tx.commissionRecord.findMany({
        where: { attributedUidAccountId: account.id },
        orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
        take: transactionCap + 1,
        select: { id: true, asset: true, periodStart: true, periodEnd: true, cashbackRate: true, creditedCashback: true }
      }),
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
    const versions = page.length ? await tx.commissionVersion.findMany({
      where: { commissionId: { in: page.map(row => row.id) } },
      select: { id: true, commissionId: true, amount: true, importedAt: true },
      orderBy: [{ importedAt: "desc" }, { id: "desc" }]
    }) : [];
    const appliedEntries = versions.length ? await tx.walletEntry.findMany({
      where: { sourceRef: { in: versions.map(version => version.id) }, type: { in: [...attributionTypes] } },
      select: { sourceRef: true }
    }) : [];
    const credited = creditedCommissionByRecord(versions, appliedEntries);
    return lookupResponseSchema.parse({
      balances: wallets.map(w => ({ asset: w.asset, pending: w.pending.toFixed(10), available: w.available.toFixed(10) })),
      hasData: records.length > 0, hasMore, lastImportAt: applied[0]?.publishedAt?.toISOString() ?? null, sourceAsOf: applied[0]?.sourceAsOf?.toISOString() ?? null,
      transactions: page.map(row => ({
        id: row.id,
        asset: row.asset,
        periodStart: row.periodStart.toISOString(),
        periodEnd: row.periodEnd.toISOString(),
        commission: commissionForLookup(credited.get(row.id)).toFixed(10),
        cashbackRate: row.cashbackRate?.toFixed(4) ?? null,
        cashback: row.creditedCashback.toFixed(10)
      }))
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

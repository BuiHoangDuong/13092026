import { lookupRequestSchema, lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { consumeBudget, positiveConfig } from "./rate-limit.js";
export async function lookupCashback(raw: unknown, ip: string): Promise<LookupResponse> {
  const { exchangeId, uid } = lookupRequestSchema.parse(raw);
  await consumeBudget("lookup:ip", ip, [
    { seconds: 60, limit: positiveConfig("LOOKUP_RATE_PER_MINUTE", 5) },
    { seconds: 3600, limit: positiveConfig("LOOKUP_RATE_PER_HOUR", 30) }
  ]);
  return db.$transaction(async tx => {
    const account = await tx.uidAccount.findUnique({ where: { exchangeId_uid: { exchangeId, uid } }, select: { id: true } });
    if (!account) return { balances: [], hasData: false, lastImportAt: null, sourceAsOf: null };
    const wallets = await tx.wallet.findMany({ where: { uidAccountId: account.id }, orderBy: { asset: "asc" }, select: { asset: true, pending: true, available: true } });
    const record = await tx.commissionRecord.findFirst({ where: { attributedUidAccountId: account.id }, select: { id: true } });
    const applied = await tx.$queryRaw<Array<{ publishedAt: Date | null; sourceAsOf: Date | null }>>(Prisma.sql`
      SELECT b."publishedAt", b."sourceAsOf" FROM "WalletEntry" e
      JOIN "Wallet" w ON w.id = e."walletId"
      JOIN "CommissionVersion" v ON v.id = e."sourceRef"
      JOIN "ImportBatch" b ON b.id = v."batchId"
      WHERE w."uidAccountId" = ${account.id} ORDER BY b."publishedAt" DESC NULLS LAST LIMIT 1
    `);
    return lookupResponseSchema.parse({
      balances: wallets.map(w => ({ asset: w.asset, pending: w.pending.toFixed(10), available: w.available.toFixed(10) })),
      hasData: Boolean(record), lastImportAt: applied[0]?.publishedAt?.toISOString() ?? null, sourceAsOf: applied[0]?.sourceAsOf?.toISOString() ?? null
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

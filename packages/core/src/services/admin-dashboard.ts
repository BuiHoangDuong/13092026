import { db, Prisma } from "@cashback/db";

type CountRow = { id: string; name: string; clicks: bigint };
type LinkRow = { id: string; exchangeId: string; exchange: string; destination: string; clicks: bigint };
type DayRow = { day: Date; clicks: bigint };
type AttributionRow = {
  exchangeId: string; exchange: string; attributedRecords: bigint; unattributedRecords: bigint;
  attributedCommission: Prisma.Decimal; unattributedCommission: Prisma.Decimal; creditedCashback: Prisma.Decimal;
};

export async function getAdminAnalytics(rangeDays = 30) {
  const days = Math.max(1, Math.min(90, Math.trunc(rangeDays)));
  const since = new Date(Date.now() - days * 86_400_000);
  const [totalClicks, clicksByDay, links, exchanges, attribution] = await Promise.all([
    db.clickEvent.count({ where: { createdAt: { gte: since } } }),
    db.$queryRaw<DayRow[]>(Prisma.sql`
      SELECT date_trunc('day', c."createdAt") AS day, count(*)::bigint AS clicks
      FROM "ClickEvent" c WHERE c."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1 ASC
    `),
    db.$queryRaw<LinkRow[]>(Prisma.sql`
      SELECT l.id, l."exchangeId", e.name AS exchange, l.destination, count(c.id)::bigint AS clicks
      FROM "ReferralLink" l JOIN "Exchange" e ON e.id = l."exchangeId"
      LEFT JOIN "ClickEvent" c ON c."linkId" = l.id AND c."createdAt" >= ${since}
      GROUP BY l.id, l."exchangeId", e.name, l.destination ORDER BY clicks DESC, l.id ASC
    `),
    db.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT e.id, e.name, count(c.id)::bigint AS clicks
      FROM "Exchange" e LEFT JOIN "ReferralLink" l ON l."exchangeId" = e.id
      LEFT JOIN "ClickEvent" c ON c."linkId" = l.id AND c."createdAt" >= ${since}
      GROUP BY e.id, e.name ORDER BY clicks DESC, e.id ASC
    `),
    db.$queryRaw<AttributionRow[]>(Prisma.sql`
      SELECT e.id AS "exchangeId", e.name AS exchange,
        count(cr.id) FILTER (WHERE cr."attributedUidAccountId" IS NOT NULL)::bigint AS "attributedRecords",
        count(cr.id) FILTER (WHERE cr."attributedUidAccountId" IS NULL)::bigint AS "unattributedRecords",
        coalesce(sum(cr."reconciledAmount") FILTER (WHERE cr."attributedUidAccountId" IS NOT NULL), 0) AS "attributedCommission",
        coalesce(sum(cr."reconciledAmount") FILTER (WHERE cr."attributedUidAccountId" IS NULL), 0) AS "unattributedCommission",
        coalesce(sum(cr."creditedCashback"), 0) AS "creditedCashback"
      FROM "Exchange" e LEFT JOIN "CommissionRecord" cr ON cr."exchangeId" = e.id
      GROUP BY e.id, e.name ORDER BY e.name ASC
    `)
  ]);
  return {
    generatedAt: new Date().toISOString(), rangeDays: days, totalClicks,
    clicksByDay: clicksByDay.map(row => ({ day: row.day.toISOString().slice(0, 10), clicks: Number(row.clicks) })),
    links: links.map(row => ({ linkId: row.id, exchangeId: row.exchangeId, exchange: row.exchange, destination: row.destination, clicks: Number(row.clicks) })),
    exchanges: exchanges.map(row => ({ exchangeId: row.id, exchange: row.name, clicks: Number(row.clicks) })),
    attribution: attribution.map(row => ({
      exchangeId: row.exchangeId, exchange: row.exchange, attributedRecords: Number(row.attributedRecords),
      unattributedRecords: Number(row.unattributedRecords), attributedCommission: row.attributedCommission.toFixed(10),
      unattributedCommission: row.unattributedCommission.toFixed(10), creditedCashback: row.creditedCashback.toFixed(10)
    }))
  };
}

export async function getAdminSyncStatus() {
  const [latestSuccess, imports, jobs, exchanges] = await Promise.all([
    db.importBatch.findFirst({ where: { status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true, sourceAsOf: true } }),
    db.importBatch.findMany({ take: 20, orderBy: { createdAt: "desc" }, select: {
      id: true, exchangeId: true, rootAccount: true, status: true, createdAt: true, publishedAt: true, sourceAsOf: true
    } }),
    db.job.groupBy({ by: ["state"], _count: { _all: true } }),
    db.exchange.findMany({ select: { id: true, name: true } })
  ]);
  const exchangeNames = new Map(exchanges.map(exchange => [exchange.id, exchange.name]));
  return {
    generatedAt: new Date().toISOString(), apiSync: { enabled: false, state: "DISABLED" as const },
    lastSuccessfulImportAt: latestSuccess?.publishedAt?.toISOString() ?? null,
    sourceAsOf: latestSuccess?.sourceAsOf?.toISOString() ?? null,
    jobs: jobs.map(row => ({ state: row.state, count: row._count._all })),
    imports: imports.map(row => ({
      id: row.id, exchangeId: row.exchangeId, exchange: exchangeNames.get(row.exchangeId) ?? row.exchangeId, rootAccount: row.rootAccount,
      status: row.status, createdAt: row.createdAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
      sourceAsOf: row.sourceAsOf?.toISOString() ?? null
    }))
  };
}

type ActivityRow = { id: string; kind: "COMMISSION" | "WALLET" | "WITHDRAWAL"; occurredAt: Date; asset: string; amount: string; status: string; detail: string | null };

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { at?: string; id?: string };
    const at = new Date(value.at ?? "");
    if (!value.id || !Number.isFinite(at.getTime())) throw new Error();
    return { at, id: value.id };
  } catch { throw new Error("INVALID_CURSOR"); }
}

export async function getAdminAccountActivity(uidAccountId: string, cursor?: string, requestedLimit = 25) {
  const limit = Math.max(1, Math.min(50, Math.trunc(requestedLimit)));
  const account = await db.uidAccount.findUnique({ where: { id: uidAccountId }, include: { exchange: { select: { name: true } } } });
  if (!account) throw new Error("ACCOUNT_NOT_FOUND");
  const decoded = decodeCursor(cursor);
  const before = decoded ? { OR: [{ createdAt: { lt: decoded.at } }, { createdAt: decoded.at, id: { lt: decoded.id } }] } : {};
  const [commissions, walletEntries, withdrawals] = await Promise.all([
    db.commissionRecord.findMany({ where: { attributedUidAccountId: uidAccountId, ...before }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }),
    db.walletEntry.findMany({ where: { wallet: { uidAccountId }, ...before }, include: { wallet: { select: { asset: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 }),
    db.withdrawal.findMany({ where: { uidAccountId, ...before }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1 })
  ]);
  const activity: ActivityRow[] = [
    ...commissions.map(row => ({ id: row.id, kind: "COMMISSION" as const, occurredAt: row.createdAt, asset: row.asset, amount: row.reconciledAmount.toFixed(10), status: row.attributedUidAccountId ? "ATTRIBUTED" : "UNATTRIBUTED", detail: row.cashbackRate?.toFixed(4) ?? null })),
    ...walletEntries.map(row => ({ id: row.id, kind: "WALLET" as const, occurredAt: row.createdAt, asset: row.wallet.asset, amount: row.amount.toFixed(10), status: row.type, detail: row.sourceRef })),
    ...withdrawals.map(row => ({ id: row.id, kind: "WITHDRAWAL" as const, occurredAt: row.createdAt, asset: row.asset, amount: row.amount.toFixed(10), status: row.status, detail: row.payoutRef }))
  ].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id));
  const page = activity.slice(0, limit);
  const last = page.at(-1);
  return {
    account: { id: account.id, uid: account.uid, exchangeId: account.exchangeId, exchange: account.exchange.name, boundEmail: account.boundEmail, createdAt: account.createdAt.toISOString() },
    activity: page.map(row => ({ ...row, occurredAt: row.occurredAt.toISOString() })),
    nextCursor: activity.length > limit && last ? Buffer.from(JSON.stringify({ at: last.occurredAt.toISOString(), id: last.id })).toString("base64url") : null
  };
}

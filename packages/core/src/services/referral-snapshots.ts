import type { ActivityReportResponse, ReferralSnapshotsResponse } from "@cashback/contracts";
import { Prisma, db } from "@cashback/db";
import { ImportError } from "./imports.js";

const NOTE = "Reported earnings are referral-export metrics, not cashback wallet credit." as const;

type ActivitySqlRow = {
  source: "MANUAL" | "API"; rootAccount: string; uid: string; referralCode: string | null;
  partial: boolean; sourceAsOf: Date | null; kind: string; asset: string;
  valueState: string; amount: string | null;
  periodStart: Date;
};

const DAY_MS = 86_400_000;

function overlappingUtcDays(start: Date, end: Date) {
  const startDay = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
  const endDay = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const lastExclusive = endDay + DAY_MS;
  return { first: new Date(startDay), lastExclusive: new Date(lastExclusive),
    expected: Math.max(0, (lastExclusive - startDay) / DAY_MS),
    boundaryPartial: start.getTime() !== startDay || end.getTime() !== lastExclusive - 1 };
}

export async function listReportedActivity(input: { exchangeId: string; periodStart: string; periodEnd: string; cursor?: string; limit?: number }): Promise<ActivityReportResponse> {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
    throw new ImportError("IMPORT_INVALID", "Invalid report period");
  }
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const days = overlappingUtcDays(periodStart, periodEnd);
  const mexc = (await db.exchange.findUnique({ where: { id: input.exchangeId }, select: { slug: true } }))?.slug === "mexc";
  if (days.expected > 366) throw new ImportError("IMPORT_INVALID", "Choose at most 366 complete UTC days");
  const manualFilter = Prisma.sql`v.source = 'MANUAL' AND v."periodStart" = ${periodStart} AND v."periodEnd" = ${periodEnd}`;
  const apiFilter = days.expected ? Prisma.sql`v.source = 'API' AND v."periodStart" >= ${days.first} AND v."periodEnd" < ${days.lastExclusive}` : Prisma.sql`FALSE`;
  const rosterFilter = days.expected ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
  const statuses = days.expected ? await db.activityPeriodStatus.findMany({ where: { exchangeId: input.exchangeId, periodDate: { gte: days.first, lt: days.lastExclusive } } }) : [];
  const cursor = input.cursor ? Prisma.sql`WHERE uid > ${input.cursor}` : Prisma.empty;
  const ids = await db.$queryRaw<Array<{ uid: string }>>`
    WITH candidates AS (
      SELECT DISTINCT v.uid FROM "referral_activity_v" v WHERE v."exchangeId" = ${input.exchangeId} AND (${manualFilter} OR ${apiFilter})
      UNION
      SELECT r.uid FROM "ActivityRoster" r WHERE r."exchangeId" = ${input.exchangeId} AND ${rosterFilter}
    )
    SELECT uid FROM candidates ${cursor} ORDER BY uid LIMIT ${limit + 1}`;
  const pageIds = ids.slice(0, limit).map((item) => item.uid);
  const nextCursor = ids.length > limit ? pageIds.at(-1) ?? null : null;
  const [rows, roster] = pageIds.length ? await Promise.all([
    db.$queryRaw<ActivitySqlRow[]>`
      SELECT v.source, v."rootAccount", v.uid, v."referralCode", v.partial, v."sourceAsOf", v.kind, v."periodStart",
        v.asset, v."valueState"::text AS "valueState", v.amount::text AS amount
      FROM "referral_activity_v" v WHERE v."exchangeId" = ${input.exchangeId}
        AND v.uid IN (${Prisma.join(pageIds)}) AND (${manualFilter} OR ${apiFilter})
      ORDER BY v.uid, v.source, v."rootAccount", v.kind, v.asset`,
    days.expected ? db.activityRoster.findMany({ where: { exchangeId: input.exchangeId, uid: { in: pageIds } } }) : Promise.resolve([])
  ]) : [[], []];
  const byRoot = new Map<string, { rootAccount: string; expected: number; fetched: number; open: number; missing: number; sourceAsOf: string | null; fetchedAt: string | null }>();
  for (const status of statuses) {
    const item = byRoot.get(status.rootAccount) ?? { rootAccount: status.rootAccount, expected: days.expected, fetched: 0, open: 0, missing: days.expected, sourceAsOf: null, fetchedAt: null };
    item.fetched += 1;
    if (status.state !== "SEALED") item.open += 1;
    item.missing = Math.max(0, item.expected - item.fetched);
    const sourceAsOf = status.sourceAsOf?.toISOString() ?? null;
    const fetchedAt = status.fetchedAt?.toISOString() ?? null;
    if (sourceAsOf && (!item.sourceAsOf || sourceAsOf > item.sourceAsOf)) item.sourceAsOf = sourceAsOf;
    if (fetchedAt && (!item.fetchedAt || fetchedAt > item.fetchedAt)) item.fetchedAt = fetchedAt;
    byRoot.set(status.rootAccount, item);
  }
  for (const item of roster) if (!byRoot.has(item.rootAccount)) byRoot.set(item.rootAccount, { rootAccount: item.rootAccount, expected: days.expected, fetched: 0, open: 0, missing: days.expected, sourceAsOf: null, fetchedAt: null });
  const groups = new Map<string, ActivityReportResponse["activity"][number]>();
  const manualKeys = new Set(rows.filter((row) => row.source === "MANUAL").map((row) => `${row.rootAccount}:${row.uid}`));
  for (const item of roster) {
    if (manualKeys.has(`${item.rootAccount}:${item.uid}`) && !rows.some((row) => row.source === "API" && row.rootAccount === item.rootAccount && row.uid === item.uid)) continue;
    const coverage = byRoot.get(item.rootAccount)!;
    groups.set(`API:${item.rootAccount}:${item.uid}`, { uid: item.uid, source: "API", rootAccount: item.rootAccount,
      referralCode: item.referralCode, partial: days.boundaryPartial || coverage.open > 0 || coverage.missing > 0,
      sourceAsOf: coverage.sourceAsOf, fetchedAt: coverage.fetchedAt,
      dataState: mexc || coverage.open || coverage.missing ? "INCOMPLETE" : "NO_ACTIVITY", metrics: [] });
  }
  const metricTotals = new Map<string, Prisma.Decimal>();
  const reportedDays = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = `${row.source}:${row.rootAccount}:${row.uid}`;
    if (mexc && row.source === "API") {
      const present = reportedDays.get(key) ?? new Set<string>();
      present.add(new Date(row.periodStart).toISOString().slice(0, 10));
      reportedDays.set(key, present);
    }
    const coverage = byRoot.get(row.rootAccount);
    const current = groups.get(key) ?? { uid: row.uid, source: row.source, rootAccount: row.rootAccount,
      referralCode: row.referralCode, partial: row.source === "API" ? Boolean(days.boundaryPartial || row.partial || (coverage && (coverage.open || coverage.missing))) : row.partial,
      sourceAsOf: row.source === "API" ? coverage?.sourceAsOf ?? null : row.sourceAsOf?.toISOString() ?? null,
      fetchedAt: row.source === "API" ? coverage?.fetchedAt ?? null : null,
      dataState: "REPORTED" as const, metrics: [] };
    const missingUidDay = mexc && row.source === "API" && reportedDays.get(key)!.size < days.expected;
    current.dataState = missingUidDay ? "INCOMPLETE" : "REPORTED";
    const metricKey = `${key}:${row.kind}:${row.asset}`;
    const previous = metricTotals.get(metricKey) ?? new Prisma.Decimal(0);
    if (row.amount != null) metricTotals.set(metricKey, previous.plus(row.amount));
    const existing = current.metrics.find((metric) => metric.kind === row.kind && metric.asset === row.asset);
    if (!existing) current.metrics.push({ kind: row.kind, asset: row.asset, valueState: row.valueState, amount: row.amount });
    else if (row.amount != null) { existing.amount = metricTotals.get(metricKey)!.toFixed(10); existing.valueState = "VALUE"; }
    groups.set(key, current);
  }
  if (mexc) for (const [key, group] of groups) {
    if (group.source === "API" && (reportedDays.get(key)?.size ?? 0) < days.expected) group.partial = true;
  }
  const activity = [...groups.values()].sort((a, b) => a.uid.localeCompare(b.uid) || a.source.localeCompare(b.source) || a.rootAccount.localeCompare(b.rootAccount));
  return { note: NOTE, nextCursor, coverageDays: [...byRoot.values()].map(({ rootAccount, expected, fetched, open, missing }) => ({ rootAccount, expected, fetched, open, missing })), activity };
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  const separator = cursor.indexOf(":");
  if (separator < 1 || separator === cursor.length - 1) throw new Error("INVALID_CURSOR");
  return { uid: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
}

export async function listReferralSnapshots(input: {
  exchangeId: string;
  periodStart: string;
  periodEnd: string;
  cursor?: string;
  limit?: number;
}): Promise<ReferralSnapshotsResponse> {
  const periodStart = new Date(input.periodStart);
  const periodEnd = new Date(input.periodEnd);
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
    throw new ImportError("IMPORT_INVALID", "Invalid report period");
  }
  const limit = input.limit ?? 50;
  // The same UID can have a current row under several root accounts, so page on (uid, id).
  const cursor = decodeCursor(input.cursor);
  const rows = await db.referralSnapshot.findMany({
    where: {
      exchangeId: input.exchangeId, periodStart, periodEnd, current: true,
      ...(cursor ? { OR: [{ uid: { gt: cursor.uid } }, { uid: cursor.uid, id: { gt: cursor.id } }] } : {})
    },
    include: { batch: { select: { sourceAsOf: true } } },
    orderBy: [{ uid: "asc" }, { id: "asc" }],
    take: limit + 1
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    note: NOTE,
    nextCursor: rows.length > limit && last ? `${last.uid}:${last.id}` : null,
    snapshots: page.map((row) => ({
      id: row.id, uid: row.uid, exchangeId: row.exchangeId, rootAccount: row.rootAccount,
      periodStart: row.periodStart.toISOString(), periodEnd: row.periodEnd.toISOString(),
      sourceAsOf: row.batch.sourceAsOf?.toISOString() ?? null,
      tradingVolume: row.tradingVolume.toFixed(10), tradingAsset: row.tradingAsset,
      reportedEarnings: row.reportedEarnings.toFixed(10), earningsAsset: row.earningsAsset,
      referralCode: row.referralCode, partial: row.partial
    }))
  };
}

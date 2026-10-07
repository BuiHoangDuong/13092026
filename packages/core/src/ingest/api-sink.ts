import type { ActivityDayState, Prisma } from "@cashback/db";
import { activityDigest, type MetricDraft } from "./contract.js";

/** A roster UID missing from this many consecutive complete fetches becomes GONE. */
export const ROSTER_GONE_AFTER = 3;

// Arrays are bound as ONE parameter each (`$1::text[]`), so row count never hits
// PostgreSQL's 65,535 bind-parameter limit (5,000 UIDs x 9 metrics would).
async function updateRoster(tx: Prisma.TransactionClient, exchangeId: string, rootAccount: string, present: Map<string, string | null>, now: Date, ageMissing = true) {
  // An empty complete fetch is quarantined by the caller; never age the whole roster on it.
  if (!present.size) return;
  const uids = [...present.keys()];
  const codes = uids.map((uid) => present.get(uid) ?? "");
  await tx.$executeRaw`
    INSERT INTO "ActivityRoster" ("exchangeId", "rootAccount", uid, "referralCode", state, "missedRuns", "firstSeenAt", "lastSeenAt")
    SELECT ${exchangeId}, ${rootAccount}, r.uid, NULLIF(r.code, ''), 'ACTIVE'::"RosterState", 0, ${now}, ${now}
    FROM unnest(${uids}::text[], ${codes}::text[]) AS r(uid, code)
    ON CONFLICT ("exchangeId", "rootAccount", uid)
    DO UPDATE SET "referralCode" = EXCLUDED."referralCode", state = 'ACTIVE', "missedRuns" = 0, "lastSeenAt" = EXCLUDED."lastSeenAt"`;
  if (!ageMissing) return;
  await tx.$executeRaw`
    UPDATE "ActivityRoster"
    SET "missedRuns" = "missedRuns" + 1,
        state = CASE WHEN "missedRuns" + 1 >= ${ROSTER_GONE_AFTER} THEN 'GONE'::"RosterState" ELSE state END
    WHERE "exchangeId" = ${exchangeId} AND "rootAccount" = ${rootAccount}
      AND NOT (uid = ANY(${uids}::text[]))`;
}

export async function publishApiDay(tx: Prisma.TransactionClient, input: {
  exchangeId: string;
  rootAccount: string;
  periodDate: string;
  runId: string;
  metrics: MetricDraft[];
  state: ActivityDayState;
  fingerprint: string;
  observedAt: Date;
  sourceAsOf: Date | null;
  updateRoster: boolean;
  preserveReportedZero?: boolean;
  ageMissingRoster?: boolean;
  contractVersion: string;
}) {
  const digest = activityDigest(input.metrics);
  const existing = await tx.activityPeriodStatus.findUnique({
    where: { exchangeId_rootAccount_periodDate: { exchangeId: input.exchangeId, rootAccount: input.rootAccount, periodDate: new Date(`${input.periodDate}T00:00:00.000Z`) } }
  });
  const now = new Date();
  const present = new Map<string, string | null>();
  for (const row of input.metrics) if (!present.has(row.uid)) present.set(row.uid, row.referralCode);
  // Roster runs before the digest gate: a UID that stays missing must keep aging
  // even when the rest of the day is unchanged.
  if (input.updateRoster) await updateRoster(tx, input.exchangeId, input.rootAccount, present, now, input.ageMissingRoster ?? true);
  if (existing?.contentDigest === digest && existing.contractVersion === input.contractVersion) {
    await tx.activityPeriodStatus.update({
      where: { exchangeId_rootAccount_periodDate: { exchangeId: input.exchangeId, rootAccount: input.rootAccount, periodDate: existing.periodDate } },
      data: { lastCheckedAt: now, fetchedAt: now, responseObservedAt: input.observedAt, sourceAsOf: input.sourceAsOf }
    });
    return { changed: 0, unchanged: true };
  }
  const uids = input.metrics.map((row) => row.uid);
  const kinds = input.metrics.map((row) => row.kind);
  const assets = input.metrics.map((row) => row.asset);
  const states = input.metrics.map((row) => row.valueState);
  const amounts = input.metrics.map((row) => row.amount ?? "");
  await tx.$executeRaw`CREATE TEMP TABLE tmp_sync_rows (
    exchange_id text, root_account text, uid text, period_date date, kind text, asset text, value_state text, amount numeric(30,10)
  ) ON COMMIT DROP`;
  if (input.metrics.length) {
    await tx.$executeRaw`
      INSERT INTO tmp_sync_rows
      SELECT ${input.exchangeId}, ${input.rootAccount}, r.uid, ${input.periodDate}::date, r.kind, r.asset, r.value_state, NULLIF(r.amount, '')::numeric
      FROM unnest(${uids}::text[], ${kinds}::text[], ${assets}::text[], ${states}::text[], ${amounts}::text[])
        AS r(uid, kind, asset, value_state, amount)`;
  }
  const changed = await tx.$queryRaw<Array<{ id: string }>>`
    WITH existing AS (
      SELECT * FROM "ActivityMetricCurrent"
      WHERE "exchangeId" = ${input.exchangeId} AND "rootAccount" = ${input.rootAccount} AND "periodDate" = ${input.periodDate}::date
    ),
    upserted AS (
      INSERT INTO "ActivityMetricCurrent" AS t
        ("exchangeId", "rootAccount", uid, "periodDate", kind, asset, "valueState", amount, "lastChangedRunId", "updatedAt")
      SELECT r.exchange_id, r.root_account, r.uid, r.period_date, r.kind::"ActivityMetricKind", r.asset, r.value_state::"MetricValueState", r.amount, ${input.runId}, now()
      FROM tmp_sync_rows r
      WHERE (r.value_state = 'VALUE' AND r.amount IS NOT NULL AND (${input.preserveReportedZero ?? false} OR r.amount <> 0))
         OR EXISTS (
           SELECT 1 FROM existing e
           WHERE e.uid = r.uid AND e.kind::text = r.kind AND e.asset = r.asset
         )
      ON CONFLICT ("exchangeId", "rootAccount", uid, "periodDate", kind, asset)
      DO UPDATE SET "valueState" = EXCLUDED."valueState", amount = EXCLUDED.amount,
                    "lastChangedRunId" = EXCLUDED."lastChangedRunId", "updatedAt" = now()
      WHERE (t."valueState", t.amount) IS DISTINCT FROM (EXCLUDED."valueState", EXCLUDED.amount)
      RETURNING t.*
    ),
    logged AS (
      INSERT INTO "ActivityMetricChange"
        ("id", "runId", "exchangeId", "rootAccount", uid, "periodDate", kind, asset, "oldState", "oldAmount", "newState", "newAmount")
      SELECT gen_random_uuid()::text, ${input.runId}, u."exchangeId", u."rootAccount", u.uid, u."periodDate", u.kind, u.asset,
             e."valueState", e.amount, u."valueState", u.amount
      FROM upserted u
      LEFT JOIN existing e ON e.uid = u.uid AND e.kind = u.kind AND e.asset = u.asset
      RETURNING "id"
    ),
    gone AS (
      UPDATE "ActivityMetricCurrent" t
      SET "valueState" = 'ABSENT', amount = NULL, "lastChangedRunId" = ${input.runId}, "updatedAt" = now()
      WHERE t."exchangeId" = ${input.exchangeId} AND t."rootAccount" = ${input.rootAccount} AND t."periodDate" = ${input.periodDate}::date
        AND t."valueState" <> 'ABSENT'
        AND NOT EXISTS (
          SELECT 1 FROM tmp_sync_rows r WHERE r.uid = t.uid AND r.kind = t.kind::text AND r.asset = t.asset
        )
      RETURNING t.*
    ),
    gone_log AS (
      INSERT INTO "ActivityMetricChange"
        ("id", "runId", "exchangeId", "rootAccount", uid, "periodDate", kind, asset, "oldState", "oldAmount", "newState", "newAmount")
      SELECT gen_random_uuid()::text, ${input.runId}, g."exchangeId", g."rootAccount", g.uid, g."periodDate", g.kind, g.asset,
             e."valueState", e.amount, 'ABSENT'::"MetricValueState", NULL
      FROM gone g
      JOIN existing e ON e.uid = g.uid AND e.kind = g.kind AND e.asset = g.asset
      RETURNING "id"
    )
    SELECT "id" FROM logged
    UNION ALL
    SELECT "id" FROM gone_log`;
  await tx.activityPeriodStatus.upsert({
    where: { exchangeId_rootAccount_periodDate: { exchangeId: input.exchangeId, rootAccount: input.rootAccount, periodDate: new Date(`${input.periodDate}T00:00:00.000Z`) } },
    create: {
      exchangeId: input.exchangeId, rootAccount: input.rootAccount, periodDate: new Date(`${input.periodDate}T00:00:00.000Z`),
      state: input.state, contentDigest: digest, schemaFingerprint: input.fingerprint, contractVersion: input.contractVersion,
      rowCount: present.size, fetchedAt: now, responseObservedAt: input.observedAt, sourceAsOf: input.sourceAsOf, lastCheckedAt: now, lastChangedRunId: input.runId
    },
    update: {
      state: input.state, contentDigest: digest, schemaFingerprint: input.fingerprint, contractVersion: input.contractVersion, rowCount: present.size,
      fetchedAt: now, responseObservedAt: input.observedAt, sourceAsOf: input.sourceAsOf, lastCheckedAt: now, lastChangedRunId: input.runId
    }
  });
  return { changed: changed.length, unchanged: false };
}

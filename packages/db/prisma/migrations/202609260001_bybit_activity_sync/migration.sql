CREATE TYPE "ActivityMetricKind" AS ENUM ('TRADE_VOLUME', 'TAKER_VOLUME', 'MAKER_VOLUME', 'TRADFI_VOLUME', 'REPORTED_COMMISSION');
CREATE TYPE "MetricValueState" AS ENUM ('VALUE', 'EMPTY', 'ABSENT');
CREATE TYPE "ActivityDayState" AS ENUM ('OPEN', 'SETTLING', 'SEALED', 'QUARANTINED');
CREATE TYPE "RosterState" AS ENUM ('ACTIVE', 'GONE');
CREATE TYPE "SyncTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'BACKFILL', 'RECONCILE', 'RESYNC');
CREATE TYPE "SyncRunState" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'QUARANTINED', 'PAUSED');
CREATE TYPE "SyncAuditAction" AS ENUM ('UPDATE_CONFIG', 'RUN_NOW', 'RESUME', 'RESYNC_RANGE', 'RELEASE_OVERRIDE');

ALTER TABLE "ImportBatch" ADD COLUMN "schemaFingerprint" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "contractVersion" TEXT;
ALTER TABLE "ImportBatch" ADD COLUMN "driftReport" JSONB;

CREATE TABLE "ReferralMetric" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "kind" "ActivityMetricKind" NOT NULL,
    "asset" TEXT NOT NULL,
    "valueState" "MetricValueState" NOT NULL,
    "amount" DECIMAL(30,10),
    CONSTRAINT "ReferralMetric_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReferralMetric_snapshotId_kind_asset_key" ON "ReferralMetric"("snapshotId", "kind", "asset");
ALTER TABLE "ReferralMetric" ADD CONSTRAINT "ReferralMetric_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ReferralSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ReferralMetric" ("id", "snapshotId", "kind", "asset", "valueState", "amount")
SELECT gen_random_uuid()::text, "id", 'TRADE_VOLUME', "tradingAsset", 'VALUE', "tradingVolume" FROM "ReferralSnapshot";
INSERT INTO "ReferralMetric" ("id", "snapshotId", "kind", "asset", "valueState", "amount")
SELECT gen_random_uuid()::text, "id", 'REPORTED_COMMISSION', "earningsAsset", 'VALUE', "reportedEarnings" FROM "ReferralSnapshot";

CREATE TABLE "ExchangeSyncConfig" (
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 30,
    "backfillDays" INTEGER NOT NULL DEFAULT 365,
    "nextRunAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFetchedPeriodEnd" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "pausedReason" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExchangeSyncConfig_pkey" PRIMARY KEY ("exchangeId")
);
ALTER TABLE "ExchangeSyncConfig" ADD CONSTRAINT "ExchangeSyncConfig_interval_check" CHECK ("intervalMinutes" IN (30, 60, 720, 1440));
ALTER TABLE "ExchangeSyncConfig" ADD CONSTRAINT "ExchangeSyncConfig_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "trigger" "SyncTrigger" NOT NULL,
    "state" "SyncRunState" NOT NULL,
    "contractVersion" TEXT NOT NULL,
    "changedRows" INTEGER NOT NULL DEFAULT 0,
    "driftReport" JSONB,
    "checkpoint" JSONB,
    "daysWritten" JSONB,
    "safeErrorCode" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncRun_exchangeId_createdAt_idx" ON "SyncRun"("exchangeId", "createdAt");
CREATE UNIQUE INDEX "SyncRun_one_active_idx" ON "SyncRun"("exchangeId", "rootAccount") WHERE "state" IN ('QUEUED', 'RUNNING');

CREATE TABLE "ActivityPeriodOverride" (
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "manualBatchId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityPeriodOverride_pkey" PRIMARY KEY ("exchangeId", "rootAccount", "periodStart", "periodEnd")
);

CREATE TABLE "SyncConfigAudit" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" "SyncAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncConfigAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SyncConfigAudit_exchangeId_createdAt_idx" ON "SyncConfigAudit"("exchangeId", "createdAt");

CREATE TABLE "ActivityRoster" (
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "referralCode" TEXT,
    "state" "RosterState" NOT NULL DEFAULT 'ACTIVE',
    "missedRuns" INTEGER NOT NULL DEFAULT 0,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityRoster_pkey" PRIMARY KEY ("exchangeId", "rootAccount", "uid")
);

CREATE TABLE "ActivityPeriodStatus" (
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "state" "ActivityDayState" NOT NULL,
    "contentDigest" TEXT,
    "schemaFingerprint" TEXT,
    "contractVersion" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "fetchedAt" TIMESTAMP(3),
    "responseObservedAt" TIMESTAMP(3),
    "sourceAsOf" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,
    "lastChangedRunId" TEXT,
    CONSTRAINT "ActivityPeriodStatus_pkey" PRIMARY KEY ("exchangeId", "rootAccount", "periodDate")
);

CREATE TABLE "ActivityMetricCurrent" (
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "kind" "ActivityMetricKind" NOT NULL,
    "asset" TEXT NOT NULL,
    "valueState" "MetricValueState" NOT NULL,
    "amount" DECIMAL(30,10),
    "lastChangedRunId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ActivityMetricCurrent_pkey" PRIMARY KEY ("exchangeId", "rootAccount", "uid", "periodDate", "kind", "asset")
);
CREATE INDEX "ActivityMetricCurrent_exchangeId_rootAccount_periodDate_idx" ON "ActivityMetricCurrent"("exchangeId", "rootAccount", "periodDate");

CREATE TABLE "ActivityMetricChange" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "periodDate" DATE NOT NULL,
    "kind" "ActivityMetricKind" NOT NULL,
    "asset" TEXT NOT NULL,
    "oldState" "MetricValueState",
    "oldAmount" DECIMAL(30,10),
    "newState" "MetricValueState" NOT NULL,
    "newAmount" DECIMAL(30,10),
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityMetricChange_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityMetricChange_exchangeId_rootAccount_periodDate_idx" ON "ActivityMetricChange"("exchangeId", "rootAccount", "periodDate");
CREATE INDEX "ActivityMetricChange_runId_idx" ON "ActivityMetricChange"("runId");

CREATE TABLE "SyncRateSlot" (
    "id" TEXT NOT NULL,
    "nextRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncRateSlot_pkey" PRIMARY KEY ("id")
);
INSERT INTO "SyncRateSlot" ("id", "nextRequestAt") VALUES ('bybit-affiliate', CURRENT_TIMESTAMP);

CREATE VIEW "referral_activity_v" AS
SELECT 'MANUAL'::text AS source, s."exchangeId", s."rootAccount", s.uid, s."periodStart", s."periodEnd",
       m.kind::text AS kind, m.asset, m."valueState"::text AS "valueState", m.amount, s.partial,
       b."sourceAsOf", s."referralCode"
FROM "ReferralSnapshot" s
JOIN "ReferralMetric" m ON m."snapshotId" = s.id
JOIN "ImportBatch" b ON b.id = s."batchId"
WHERE s.current = true
UNION ALL
SELECT 'API'::text, c."exchangeId", c."rootAccount", c.uid,
       c."periodDate"::timestamp, (c."periodDate"::timestamp + interval '1 day' - interval '1 millisecond'),
       c.kind::text, c.asset, c."valueState"::text, c.amount, (p.state = 'OPEN'),
       p."sourceAsOf", r."referralCode"
FROM "ActivityMetricCurrent" c
JOIN "ActivityPeriodStatus" p ON p."exchangeId" = c."exchangeId" AND p."rootAccount" = c."rootAccount" AND p."periodDate" = c."periodDate"
LEFT JOIN "ActivityRoster" r ON r."exchangeId" = c."exchangeId" AND r."rootAccount" = c."rootAccount" AND r.uid = c.uid
WHERE c."valueState" <> 'ABSENT'
  AND NOT EXISTS (
    SELECT 1 FROM "ActivityPeriodOverride" o
    WHERE o.active AND o."exchangeId" = c."exchangeId" AND o."rootAccount" = c."rootAccount"
      AND o."periodStart" <= c."periodDate"::timestamp
      AND o."periodEnd" >= (c."periodDate"::timestamp + interval '1 day' - interval '1 millisecond')
  );

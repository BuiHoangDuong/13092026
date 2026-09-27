ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'LOAD';
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'TRANSFORM';

CREATE TYPE "RawLoadState" AS ENUM ('LOADED', 'TRANSFORMED', 'FAILED', 'SUPERSEDED');

CREATE TABLE "RawLoad" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "exchangeId" TEXT NOT NULL,
  "sourceSystem" TEXT NOT NULL,
  "datasetKind" "IngestDatasetKind" NOT NULL,
  "sourceMethod" "IngestSourceMethod" NOT NULL,
  "rootAccount" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "batchId" TEXT,
  "runId" TEXT,
  "state" "RawLoadState" NOT NULL DEFAULT 'LOADED',
  "rowCount" INTEGER NOT NULL,
  "fieldNames" JSONB NOT NULL,
  "schemaFingerprint" TEXT NOT NULL,
  "sourceMetadata" JSONB,
  "driftReport" JSONB,
  "safeErrorCode" TEXT,
  "loadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "transformedAt" TIMESTAMP(3),
  CONSTRAINT "RawLoad_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL
);
CREATE INDEX "RawLoad_slice_idx" ON "RawLoad"("exchangeId", "datasetKind", "sourceMethod", "rootAccount", "periodStart", "periodEnd");
CREATE INDEX "RawLoad_state_loadedAt_idx" ON "RawLoad"("state", "loadedAt");
CREATE INDEX "RawLoad_batchId_idx" ON "RawLoad"("batchId");
CREATE INDEX "RawLoad_runId_idx" ON "RawLoad"("runId");
CREATE UNIQUE INDEX "RawLoad_current_slice_key" ON "RawLoad"("exchangeId", "datasetKind", "sourceMethod", "rootAccount", "periodStart", "periodEnd") WHERE "state" <> 'SUPERSEDED';

CREATE TABLE "RawTransformAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "loadId" TEXT NOT NULL,
  "adminId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RawTransformAudit_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "RawLoad"("id") ON DELETE RESTRICT
);
CREATE INDEX "RawTransformAudit_loadId_createdAt_idx" ON "RawTransformAudit"("loadId", "createdAt");

CREATE TABLE raw_record (
  id bigint GENERATED ALWAYS AS IDENTITY,
  _source_system text NOT NULL,
  _load_id text NOT NULL,
  _loaded_at timestamptz NOT NULL DEFAULT now(),
  row_no integer NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (_source_system, id)
) PARTITION BY LIST (_source_system);
CREATE TABLE raw_bybit PARTITION OF raw_record FOR VALUES IN ('bybit');
CREATE TABLE raw_mexc PARTITION OF raw_record FOR VALUES IN ('mexc');
CREATE TABLE raw_binance PARTITION OF raw_record FOR VALUES IN ('binance');
CREATE TABLE raw_bingx PARTITION OF raw_record FOR VALUES IN ('bingx');
CREATE TABLE raw_default PARTITION OF raw_record DEFAULT;
CREATE INDEX raw_record_load_row_idx ON raw_record (_load_id, row_no);

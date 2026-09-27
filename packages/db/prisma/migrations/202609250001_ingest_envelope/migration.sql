-- CreateEnum
CREATE TYPE "IngestDatasetKind" AS ENUM ('REFERRAL_ACTIVITY', 'COMMISSION');

-- CreateEnum
CREATE TYPE "IngestSourceMethod" AS ENUM ('NATIVE_FILE', 'NORMALIZED_FILE', 'OFFICIAL_API');

-- Existing batches are Bybit normalized commission CSVs.
ALTER TABLE "ImportBatch" ADD COLUMN "datasetKind" "IngestDatasetKind";
ALTER TABLE "ImportBatch" ADD COLUMN "sourceMethod" "IngestSourceMethod";
UPDATE "ImportBatch" SET "datasetKind" = 'COMMISSION', "sourceMethod" = 'NORMALIZED_FILE';
ALTER TABLE "ImportBatch" ALTER COLUMN "datasetKind" SET NOT NULL;
ALTER TABLE "ImportBatch" ALTER COLUMN "sourceMethod" SET NOT NULL;
ALTER TABLE "ImportBatch" ALTER COLUMN "reportType" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ReferralSnapshot" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "tradingVolume" DECIMAL(30,10) NOT NULL,
    "tradingAsset" TEXT NOT NULL,
    "reportedEarnings" DECIMAL(30,10) NOT NULL,
    "earningsAsset" TEXT NOT NULL,
    "referralCode" TEXT,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "current" BOOLEAN NOT NULL DEFAULT true,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferralSnapshot_batchId_uid_key" ON "ReferralSnapshot"("batchId", "uid");
CREATE INDEX "ReferralSnapshot_period_current_idx" ON "ReferralSnapshot"("exchangeId", "rootAccount", "periodStart", "periodEnd", "current");
CREATE INDEX "ReferralSnapshot_exchangeId_uid_periodEnd_idx" ON "ReferralSnapshot"("exchangeId", "uid", "periodEnd");
CREATE UNIQUE INDEX "ReferralSnapshot_current_identity_idx" ON "ReferralSnapshot"("exchangeId", "rootAccount", "uid", "periodStart", "periodEnd") WHERE "current" = true;

ALTER TABLE "ReferralSnapshot" ADD CONSTRAINT "ReferralSnapshot_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

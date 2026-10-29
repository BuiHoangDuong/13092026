-- AlterTable
ALTER TABLE "Exchange" ADD COLUMN "commissionVolumeRate" DECIMAL(12,10) NOT NULL DEFAULT 0.01;
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_commissionVolumeRate_check" CHECK ("commissionVolumeRate" BETWEEN 0 AND 1);

-- CreateIndex
CREATE INDEX "ImportBatch_exchangeId_datasetKind_status_periodEnd_idx" ON "ImportBatch"("exchangeId", "datasetKind", "status", "periodEnd");

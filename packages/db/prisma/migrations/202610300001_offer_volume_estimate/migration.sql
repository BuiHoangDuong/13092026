-- AlterTable
ALTER TABLE "Offer" ADD COLUMN "estimatedVolumeRate" DECIMAL(12,10);
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_estimatedVolumeRate_check" CHECK ("estimatedVolumeRate" IS NULL OR "estimatedVolumeRate" BETWEEN 0 AND 1);

-- CreateIndex
CREATE INDEX "ImportBatch_exchangeId_datasetKind_status_periodEnd_idx" ON "ImportBatch"("exchangeId", "datasetKind", "status", "periodEnd");

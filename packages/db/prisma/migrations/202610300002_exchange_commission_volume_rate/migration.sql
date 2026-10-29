-- Replace the draft Offer.estimatedVolumeRate (202610300001_offer_volume_estimate) with Exchange.commissionVolumeRate (Req 19).
ALTER TABLE "Offer" DROP CONSTRAINT IF EXISTS "Offer_estimatedVolumeRate_check";
ALTER TABLE "Offer" DROP COLUMN IF EXISTS "estimatedVolumeRate";
ALTER TABLE "Exchange" ADD COLUMN IF NOT EXISTS "commissionVolumeRate" DECIMAL(12,10) NOT NULL DEFAULT 0.01;
ALTER TABLE "Exchange" DROP CONSTRAINT IF EXISTS "Exchange_commissionVolumeRate_check";
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_commissionVolumeRate_check" CHECK ("commissionVolumeRate" BETWEEN 0 AND 1);

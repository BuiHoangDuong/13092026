ALTER TABLE "Exchange" DROP CONSTRAINT IF EXISTS "Exchange_commissionVolumeRate_check";
ALTER TABLE "Exchange" DROP COLUMN IF EXISTS "commissionVolumeRate";

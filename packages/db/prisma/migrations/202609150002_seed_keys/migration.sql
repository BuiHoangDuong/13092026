-- Stable optional keys make repository-owned seed rows idempotent without constraining
-- offers and referral links created by administrators.
ALTER TABLE "Offer" ADD COLUMN "seedKey" TEXT;
ALTER TABLE "ReferralLink" ADD COLUMN "seedKey" TEXT;

CREATE UNIQUE INDEX "Offer_seedKey_key" ON "Offer"("seedKey");
CREATE UNIQUE INDEX "ReferralLink_seedKey_key" ON "ReferralLink"("seedKey");

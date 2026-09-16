-- A referral link may only bind to an offer from the same exchange. Keeping exchangeId
-- in the foreign key makes the cashback rate-source invariant concurrency-safe.
ALTER TABLE "ReferralLink" DROP CONSTRAINT "ReferralLink_offerId_fkey";

CREATE UNIQUE INDEX "Offer_id_exchangeId_key" ON "Offer"("id", "exchangeId");

ALTER TABLE "ReferralLink"
ADD CONSTRAINT "ReferralLink_offerId_exchangeId_fkey"
FOREIGN KEY ("offerId", "exchangeId") REFERENCES "Offer"("id", "exchangeId")
ON DELETE RESTRICT ON UPDATE CASCADE;

BEGIN;
-- CreateTable
CREATE TABLE "UidAccount" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "boundEmail" TEXT,
    "emailBoundAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UidAccount_pkey" PRIMARY KEY ("id")
);
-- Financial identities are migrated from report evidence. Email binding requires a new OTP.
INSERT INTO "UidAccount" (id, "exchangeId", uid)
SELECT 'uid_' || md5("exchangeId" || ':' || uid), "exchangeId", uid FROM (
 SELECT "exchangeId", uid FROM "CommissionRecord"
 UNION SELECT "exchangeId", uid FROM "UidLink"
) pairs;
ALTER TABLE "CommissionRecord" ADD COLUMN "attributedUidAccountId" TEXT;
UPDATE "CommissionRecord" c SET "attributedUidAccountId" = a.id FROM "UidAccount" a
 WHERE a."exchangeId" = c."exchangeId" AND a.uid = c.uid AND c."attributedCustomerId" IS NOT NULL;
CREATE TEMP TABLE wallet_rekey ON COMMIT DROP AS
SELECT w.id, min(a.id) AS "uidAccountId", count(DISTINCT a.id) AS candidates FROM "Wallet" w
LEFT JOIN "CommissionRecord" c ON c."attributedCustomerId" = w."customerId" AND c.asset = w.asset
LEFT JOIN "UidAccount" a ON a."exchangeId" = c."exchangeId" AND a.uid = c.uid GROUP BY w.id;
-- A wallet with no credited report can use its sole VERIFIED legacy UID.
UPDATE wallet_rekey r SET "uidAccountId" = x.account, candidates = x.candidates FROM (
 SELECT w.id, min(a.id) AS account, count(DISTINCT a.id) AS candidates FROM "Wallet" w
 JOIN "UidLink" l ON l."customerId" = w."customerId" AND l.status = 'VERIFIED'
 JOIN "UidAccount" a ON a."exchangeId" = l."exchangeId" AND a.uid = l.uid GROUP BY w.id
) x WHERE r.id = x.id AND r.candidates = 0;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM wallet_rekey WHERE candidates <> 1) THEN
  RAISE EXCEPTION 'UID re-key requires explicit allocation for ambiguous/unmapped legacy wallets';
 END IF;
 IF EXISTS (SELECT r."uidAccountId", w.asset FROM wallet_rekey r JOIN "Wallet" w ON w.id=r.id GROUP BY r."uidAccountId",w.asset HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'UID re-key found duplicate legacy wallets; reconcile before migration';
 END IF;
END $$;
ALTER TABLE "Wallet" ADD COLUMN "uidAccountId" TEXT;
UPDATE "Wallet" w SET "uidAccountId"=r."uidAccountId" FROM wallet_rekey r WHERE r.id=w.id;
ALTER TABLE "Withdrawal" ADD COLUMN "uidAccountId" TEXT, ADD COLUMN email TEXT;
UPDATE "Withdrawal" d SET "uidAccountId"=w."uidAccountId", email=c.email FROM "Wallet" w,"Customer" c
 WHERE w."customerId"=d."customerId" AND w.asset=d.asset AND c.id=d."customerId";
DROP INDEX IF EXISTS uidlink_verified_owner;
-- AlterEnum
CREATE TYPE "ActorType_new" AS ENUM ('CLAIMANT', 'ADMIN', 'SYSTEM');
ALTER TABLE "WithdrawalEvent" ALTER COLUMN "actorType" TYPE "ActorType_new" USING ((CASE WHEN "actorType"::text = 'CUSTOMER' THEN 'CLAIMANT' ELSE "actorType"::text END)::"ActorType_new");
ALTER TYPE "ActorType" RENAME TO "ActorType_old";
ALTER TYPE "ActorType_new" RENAME TO "ActorType";
DROP TYPE "ActorType_old";

-- DropForeignKey
ALTER TABLE "UidLink" DROP CONSTRAINT "UidLink_customerId_fkey";

-- DropForeignKey
ALTER TABLE "UidLink" DROP CONSTRAINT "UidLink_referralLinkId_fkey";

-- DropForeignKey
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Withdrawal" DROP CONSTRAINT "Withdrawal_customerId_fkey";

-- DropIndex
DROP INDEX "Session_principalType_subjectId_idx";

-- DropIndex
DROP INDEX "Session_expiresAt_idx";

-- DropIndex
DROP INDEX "Wallet_customerId_asset_key";

-- DropIndex
DROP INDEX "Withdrawal_customerId_createdAt_idx";

-- AlterTable
DELETE FROM "Session" WHERE "principalType" = 'CUSTOMER';
ALTER TABLE "Session" RENAME COLUMN "subjectId" TO "adminId";
ALTER TABLE "Session" DROP COLUMN "principalType";

-- AlterTable
ALTER TABLE "CommissionRecord" DROP COLUMN "attributedCustomerId";

-- AlterTable
ALTER TABLE "Wallet" DROP COLUMN "customerId";
ALTER TABLE "Wallet" ALTER COLUMN "uidAccountId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Withdrawal" DROP COLUMN "customerId";
ALTER TABLE "Withdrawal" ALTER COLUMN "uidAccountId" SET NOT NULL;
ALTER TABLE "Withdrawal" ALTER COLUMN "email" SET NOT NULL;
ALTER TABLE "Withdrawal" ADD COLUMN "isFirst" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Withdrawal" SET "isFirst" = true WHERE id IN (SELECT DISTINCT ON ("uidAccountId") id FROM "Withdrawal" ORDER BY "uidAccountId", "createdAt", id);

-- AlterTable
ALTER TABLE "WithdrawalEvent" ADD COLUMN     "email" TEXT;
UPDATE "WithdrawalEvent" e SET email = w.email FROM "Withdrawal" w WHERE w.id = e."withdrawalId";

-- DropTable
DROP TABLE "Customer";

-- DropTable
DROP TABLE "UidLink";

-- DropEnum
DROP TYPE "PrincipalType";

-- DropEnum
DROP TYPE "UidLinkStatus";



-- CreateTable
CREATE TABLE "EmailOtp" (
    "id" TEXT NOT NULL,
    "uidAccountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "providerAccepted" BOOLEAN NOT NULL DEFAULT false,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UidSession" (
    "id" TEXT NOT NULL,
    "uidAccountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UidSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitCounter" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "subjectHash" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RateLimitCounter_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UidAccount_boundEmail_idx" ON "UidAccount"("boundEmail");

-- CreateIndex
CREATE UNIQUE INDEX "UidAccount_exchangeId_uid_key" ON "UidAccount"("exchangeId", "uid");

-- CreateIndex
CREATE INDEX "EmailOtp_uidAccountId_createdAt_idx" ON "EmailOtp"("uidAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "EmailOtp_expiresAt_idx" ON "EmailOtp"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UidSession_tokenHash_key" ON "UidSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UidSession_uidAccountId_idx" ON "UidSession"("uidAccountId");

-- CreateIndex
CREATE INDEX "RateLimitCounter_windowStart_idx" ON "RateLimitCounter"("windowStart");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitCounter_scope_subjectHash_windowStart_key" ON "RateLimitCounter"("scope", "subjectHash", "windowStart");

-- CreateIndex
CREATE INDEX "Session_adminId_idx" ON "Session"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_uidAccountId_asset_key" ON "Wallet"("uidAccountId", "asset");

-- CreateIndex
CREATE INDEX "Withdrawal_uidAccountId_createdAt_idx" ON "Withdrawal"("uidAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "UidAccount" ADD CONSTRAINT "UidAccount_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailOtp" ADD CONSTRAINT "EmailOtp_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UidSession" ADD CONSTRAINT "UidSession_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_attributedUidAccountId_fkey" FOREIGN KEY ("attributedUidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

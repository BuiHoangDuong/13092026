-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UidLinkStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('TRANSACTION', 'AGGREGATE');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('UPLOADED', 'PARSING', 'PREVIEW', 'COMMITTING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "WalletEntryType" AS ENUM ('CREDIT', 'HOLD_RELEASE', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_SETTLE', 'ADJUSTMENT', 'REVERSAL', 'CLAWBACK');

-- CreateEnum
CREATE TYPE "WithdrawalStatus" AS ENUM ('REQUESTED', 'AUTO_APPROVED', 'UNDER_REVIEW', 'APPROVED', 'PAID', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('PARSE', 'PUBLISH', 'ATTRIBUTE', 'RELEASE_HOLDS', 'SYNC');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('PENDING', 'CLAIMED', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "Exchange" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "defaultCashbackRate" DECIMAL(6,4),
    "i18n" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "cashbackRate" DECIMAL(6,4) NOT NULL,
    "conditions" JSONB,
    "verifiedAt" TIMESTAMP(3),
    "i18n" JSONB,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "offerId" TEXT,
    "destination" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Guide" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "exchangeId" TEXT,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "i18n" JSONB,

    CONSTRAINT "Guide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickEvent" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "principalType" "PrincipalType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UidLink" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "referralLinkId" TEXT,
    "status" "UidLinkStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "flaggedForReview" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),

    CONSTRAINT "UidLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "rootAccount" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sourceTz" TEXT NOT NULL,
    "sourceAsOf" TIMESTAMP(3),
    "fileRef" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagingRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "flags" JSONB,

    CONSTRAINT "StagingRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRecord" (
    "id" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "uid" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "dedupKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "reconciledAmount" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "activeVersionId" TEXT,
    "attributedCustomerId" TEXT,
    "offerId" TEXT,
    "cashbackRate" DECIMAL(6,4),
    "creditedCashback" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionVersion" (
    "id" TEXT NOT NULL,
    "commissionId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "superseded" BOOLEAN NOT NULL DEFAULT false,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "pending" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "available" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "reserved" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "withdrawn" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "receivable" DECIMAL(30,10) NOT NULL DEFAULT 0,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletEntry" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "type" "WalletEntryType" NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "sourceRef" TEXT,
    "opKey" TEXT,
    "availableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Withdrawal" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "network" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "status" "WithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "payoutRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Withdrawal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WithdrawalEvent" (
    "id" TEXT NOT NULL,
    "withdrawalId" TEXT NOT NULL,
    "fromStatus" "WithdrawalStatus",
    "toStatus" "WithdrawalStatus" NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "reference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WithdrawalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_slug_key" ON "Exchange"("slug");

-- CreateIndex
CREATE INDEX "Offer_exchangeId_status_idx" ON "Offer"("exchangeId", "status");

-- CreateIndex
CREATE INDEX "ReferralLink_exchangeId_active_idx" ON "ReferralLink"("exchangeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Guide_slug_key" ON "Guide"("slug");

-- CreateIndex
CREATE INDEX "ClickEvent_linkId_createdAt_idx" ON "ClickEvent"("linkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_email_key" ON "AdminAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_email_key" ON "Customer"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_principalType_subjectId_idx" ON "Session"("principalType", "subjectId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "UidLink_exchangeId_uid_idx" ON "UidLink"("exchangeId", "uid");

-- CreateIndex
CREATE INDEX "UidLink_customerId_idx" ON "UidLink"("customerId");

-- CreateIndex
CREATE INDEX "ImportBatch_exchangeId_createdAt_idx" ON "ImportBatch"("exchangeId", "createdAt");

-- CreateIndex
CREATE INDEX "StagingRow_batchId_idx" ON "StagingRow"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRecord_activeVersionId_key" ON "CommissionRecord"("activeVersionId");

-- CreateIndex
CREATE INDEX "CommissionRecord_exchangeId_uid_idx" ON "CommissionRecord"("exchangeId", "uid");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionRecord_exchangeId_dedupKey_key" ON "CommissionRecord"("exchangeId", "dedupKey");

-- CreateIndex
CREATE INDEX "CommissionVersion_commissionId_importedAt_idx" ON "CommissionVersion"("commissionId", "importedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionVersion_commissionId_batchId_key" ON "CommissionVersion"("commissionId", "batchId");

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_customerId_asset_key" ON "Wallet"("customerId", "asset");

-- CreateIndex
CREATE UNIQUE INDEX "WalletEntry_opKey_key" ON "WalletEntry"("opKey");

-- CreateIndex
CREATE INDEX "WalletEntry_walletId_createdAt_idx" ON "WalletEntry"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "Withdrawal_status_idx" ON "Withdrawal"("status");

-- CreateIndex
CREATE INDEX "Withdrawal_customerId_createdAt_idx" ON "Withdrawal"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "WithdrawalEvent_withdrawalId_createdAt_idx" ON "WithdrawalEvent"("withdrawalId", "createdAt");

-- CreateIndex
CREATE INDEX "Job_state_runAfter_idx" ON "Job"("state", "runAfter");

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guide" ADD CONSTRAINT "Guide_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickEvent" ADD CONSTRAINT "ClickEvent_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ReferralLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UidLink" ADD CONSTRAINT "UidLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UidLink" ADD CONSTRAINT "UidLink_referralLinkId_fkey" FOREIGN KEY ("referralLinkId") REFERENCES "ReferralLink"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagingRow" ADD CONSTRAINT "StagingRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRecord" ADD CONSTRAINT "CommissionRecord_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "CommissionVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionVersion" ADD CONSTRAINT "CommissionVersion_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "CommissionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionVersion" ADD CONSTRAINT "CommissionVersion_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletEntry" ADD CONSTRAINT "WalletEntry_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Withdrawal" ADD CONSTRAINT "Withdrawal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WithdrawalEvent" ADD CONSTRAINT "WithdrawalEvent_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "Withdrawal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only one customer may own a verified exchange UID. Pending and rejected claims remain auditable.
CREATE UNIQUE INDEX "uidlink_verified_owner"
ON "UidLink" ("exchangeId", "uid")
WHERE "status" = 'VERIFIED';

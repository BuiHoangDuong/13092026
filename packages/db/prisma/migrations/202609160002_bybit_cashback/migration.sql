ALTER TABLE "UidLink" ADD COLUMN "ownershipApprovedAt" TIMESTAMP(3), ADD COLUMN "ownershipNote" TEXT, ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ImportBatch" ADD COLUMN "originalFile" BYTEA, ADD COLUMN "publishedAt" TIMESTAMP(3);
ALTER TABLE "CommissionRecord" ADD COLUMN "reportType" "ReportType", ADD COLUMN "rootAccount" TEXT;
ALTER TABLE "CommissionVersion" ADD COLUMN "referralLinkId" TEXT;
ALTER TABLE "WalletEntry" ADD COLUMN "remainingPending" DECIMAL(30,10) NOT NULL DEFAULT 0;
ALTER TABLE "WalletEntry" ADD COLUMN "balanceChanges" JSONB;
ALTER TABLE "Job" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "Wallet" ADD CONSTRAINT "wallet_nonnegative" CHECK (pending >= 0 AND available >= 0 AND reserved >= 0 AND withdrawn >= 0 AND receivable >= 0);
ALTER TABLE "WalletEntry" ADD CONSTRAINT "remaining_pending_nonnegative" CHECK ("remainingPending" >= 0);

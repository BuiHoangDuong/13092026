-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID');

-- CreateEnum
CREATE TYPE "AllocationState" AS ENUM ('ACTIVE', 'RELEASED', 'SETTLED');

-- CreateEnum
CREATE TYPE "ExecutionState" AS ENUM ('AWAITING_APPROVAL', 'READY', 'DISPATCHING', 'SUBMITTED', 'UNKNOWN', 'CONFIRMED', 'FAILED_NOT_SENT', 'INVALIDATED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SyncScopeState" AS ENUM ('SYNCED', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "MoneyFlowMode" AS ENUM ('LEGACY', 'FROZEN', 'PAYABLE_ONLY');

-- CreateEnum
CREATE TYPE "SlotState" AS ENUM ('RUNNING', 'DONE', 'MISSED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "CommandStatus" AS ENUM ('ACCEPTED', 'DONE', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JobType" ADD VALUE 'SYNC_PAYABLES';
ALTER TYPE "JobType" ADD VALUE 'PAYOUT_SLOT';
ALTER TYPE "JobType" ADD VALUE 'PAYOUT_RECONCILE';
ALTER TYPE "JobType" ADD VALUE 'PAYABLE_COMMAND';

-- CreateTable
CREATE TABLE "CustomerPayable" (
    "id" TEXT NOT NULL,
    "uidAccountId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "sourceReleaseEntryId" TEXT NOT NULL,
    "entitlement" DECIMAL(30,10) NOT NULL,
    "settledAmount" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "activeAmount" DECIMAL(30,10) NOT NULL DEFAULT 0,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "version" INTEGER NOT NULL DEFAULT 1,
    "releasedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPayable_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutExecution" (
    "id" TEXT NOT NULL,
    "uidAccountId" TEXT NOT NULL,
    "exchangeId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "total" DECIMAL(30,10) NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL,
    "state" "ExecutionState" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "valuationMode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedVersion" INTEGER,
    "approvedTotal" DECIMAL(30,10),
    "earliestSendAt" TIMESTAMP(3) NOT NULL,
    "blockers" JSONB NOT NULL DEFAULT '[]',
    "dispatchKey" TEXT,
    "sourceAccountId" TEXT,
    "snapshot" JSONB,
    "providerRef" TEXT,
    "paidAmount" DECIMAL(30,10),
    "feeAmount" DECIMAL(30,10),
    "failureCode" TEXT,
    "previousExecutionId" TEXT,
    "legacyWithdrawalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayableAllocation" (
    "id" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "amount" DECIMAL(30,10) NOT NULL,
    "state" "AllocationState" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "PayableAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayableEvent" (
    "id" TEXT NOT NULL,
    "uidAccountId" TEXT NOT NULL,
    "executionId" TEXT,
    "payableId" TEXT,
    "kind" TEXT NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayableEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayableSyncScope" (
    "uidAccountId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL DEFAULT 0,
    "appliedVersion" INTEGER NOT NULL DEFAULT 0,
    "state" "SyncScopeState" NOT NULL DEFAULT 'PENDING',
    "pendingCorrection" BOOLEAN NOT NULL DEFAULT false,
    "invariantError" TEXT,
    "lastError" TEXT,
    "lastAppliedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayableSyncScope_pkey" PRIMARY KEY ("uidAccountId","asset")
);

-- CreateTable
CREATE TABLE "PayoutSlot" (
    "slotKey" TEXT NOT NULL,
    "cutoffAt" TIMESTAMP(3) NOT NULL,
    "state" "SlotState" NOT NULL DEFAULT 'RUNNING',
    "manifest" JSONB,
    "summary" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PayoutSlot_pkey" PRIMARY KEY ("slotKey")
);

-- CreateTable
CREATE TABLE "PayableCommand" (
    "id" TEXT NOT NULL,
    "commandKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "status" "CommandStatus" NOT NULL DEFAULT 'ACCEPTED',
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "PayableCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyFlowGate" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" "MoneyFlowMode" NOT NULL DEFAULT 'LEGACY',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MoneyFlowGate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayable_sourceReleaseEntryId_key" ON "CustomerPayable"("sourceReleaseEntryId");

-- CreateIndex
CREATE INDEX "CustomerPayable_uidAccountId_asset_releasedAt_idx" ON "CustomerPayable"("uidAccountId", "asset", "releasedAt");

-- CreateIndex
CREATE INDEX "CustomerPayable_paymentStatus_closedAt_idx" ON "CustomerPayable"("paymentStatus", "closedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPayable_uidAccountId_asset_sourceReleaseEntryId_key" ON "CustomerPayable"("uidAccountId", "asset", "sourceReleaseEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutExecution_dispatchKey_key" ON "PayoutExecution"("dispatchKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutExecution_legacyWithdrawalId_key" ON "PayoutExecution"("legacyWithdrawalId");

-- CreateIndex
CREATE INDEX "PayoutExecution_uidAccountId_asset_state_idx" ON "PayoutExecution"("uidAccountId", "asset", "state");

-- CreateIndex
CREATE INDEX "PayoutExecution_state_earliestSendAt_idx" ON "PayoutExecution"("state", "earliestSendAt");

-- CreateIndex
CREATE INDEX "PayoutExecution_slotKey_idx" ON "PayoutExecution"("slotKey");

-- CreateIndex
CREATE INDEX "PayableAllocation_payableId_state_idx" ON "PayableAllocation"("payableId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "PayableAllocation_executionId_payableId_key" ON "PayableAllocation"("executionId", "payableId");

-- CreateIndex
CREATE INDEX "PayableEvent_uidAccountId_createdAt_idx" ON "PayableEvent"("uidAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "PayableEvent_executionId_createdAt_idx" ON "PayableEvent"("executionId", "createdAt");

-- CreateIndex
CREATE INDEX "PayableSyncScope_state_idx" ON "PayableSyncScope"("state");

-- CreateIndex
CREATE UNIQUE INDEX "PayableCommand_commandKey_key" ON "PayableCommand"("commandKey");

-- CreateIndex
CREATE INDEX "PayableCommand_executionId_createdAt_idx" ON "PayableCommand"("executionId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerPayable" ADD CONSTRAINT "CustomerPayable_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPayable" ADD CONSTRAINT "CustomerPayable_sourceReleaseEntryId_fkey" FOREIGN KEY ("sourceReleaseEntryId") REFERENCES "WalletEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutExecution" ADD CONSTRAINT "PayoutExecution_uidAccountId_fkey" FOREIGN KEY ("uidAccountId") REFERENCES "UidAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableAllocation" ADD CONSTRAINT "PayableAllocation_executionId_fkey" FOREIGN KEY ("executionId") REFERENCES "PayoutExecution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayableAllocation" ADD CONSTRAINT "PayableAllocation_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "CustomerPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ledger invariants that Prisma cannot declare (Req 22.10, 22.14, 22.18).
ALTER TABLE "CustomerPayable" ADD CONSTRAINT "CustomerPayable_amounts_check"
  CHECK ("entitlement" >= 0 AND "settledAmount" >= 0 AND "activeAmount" >= 0 AND "entitlement" >= "settledAmount" + "activeAmount");
ALTER TABLE "PayableAllocation" ADD CONSTRAINT "PayableAllocation_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PayoutExecution" ADD CONSTRAINT "PayoutExecution_total_positive" CHECK ("total" > 0);
-- A payable can carry at most one ACTIVE allocation: two executions cannot claim the same money.
CREATE UNIQUE INDEX "PayableAllocation_one_active_per_payable" ON "PayableAllocation"("payableId") WHERE "state" = 'ACTIVE';
-- One non-terminal execution per (UID account, asset): merging happens before DISPATCHING, never a second obligation.
CREATE UNIQUE INDEX "PayoutExecution_one_open_per_scope" ON "PayoutExecution"("uidAccountId", "asset")
  WHERE "state" IN ('AWAITING_APPROVAL', 'READY', 'DISPATCHING', 'SUBMITTED', 'UNKNOWN');
-- Provider transfer references are unique per execution record (settlement is idempotent on the reference).
CREATE UNIQUE INDEX "PayoutExecution_provider_ref_unique" ON "PayoutExecution"("exchangeId", "sourceAccountId", "providerRef") WHERE "providerRef" IS NOT NULL;
ALTER TABLE "MoneyFlowGate" ADD CONSTRAINT "MoneyFlowGate_single_row" CHECK ("id" = 1);
-- Fail-closed default: existing deployments stay on the legacy flow until the cutover tool changes the mode.
INSERT INTO "MoneyFlowGate" ("id", "mode", "version", "updatedAt") VALUES (1, 'LEGACY', 1, CURRENT_TIMESTAMP);
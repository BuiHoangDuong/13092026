ALTER TABLE "ExchangeSyncConfig" ADD COLUMN "adminPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TYPE "SyncAuditAction" ADD VALUE 'PAUSE';

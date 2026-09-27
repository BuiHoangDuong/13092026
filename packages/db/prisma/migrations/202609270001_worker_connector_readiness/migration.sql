ALTER TABLE "ExchangeSyncConfig"
  ADD COLUMN "credentialsConfigured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "readinessReady" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "readinessReason" TEXT,
  ADD COLUMN "readinessCheckedAt" TIMESTAMP(3),
  ADD COLUMN "readinessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "readinessIpWarning" BOOLEAN NOT NULL DEFAULT false;

# Production operations

## Deploy and migrations

Railway builds reproducibly from `pnpm-lock.yaml`. The web service is the single migration
owner and runs `pnpm --filter @cashback/db db:migrate` as its pre-deploy command. A failed
migration prevents the new web deployment from starting. The worker never runs migrations.

Preview IaC changes with `railway config plan`. Applying a plan changes Railway and remains
a separate operator action.

## Health and alerts

`GET /api/health` returns database reachability, queue counts, oldest pending-job age,
worker heartbeat freshness, and the 24-hour import failure rate. It never returns job
payloads, report rows, credentials, or exception details. Database failure returns 503;
operational threshold breaches return 200 with `status: "DEGRADED"` so Railway does not
restart a healthy web process for a worker/backlog incident.

The worker logs structured `operational_health` records each minute. Threshold breaches
emit a throttled `cashback_operational_alert`; set `OPERATIONS_ALERT_WEBHOOK_URL` to an
HTTPS incident endpoint to deliver it externally.

## Backup/restore drill

Use PostgreSQL client tools matching or newer than the server. The restore target must be
a disposable database with no production traffic. The script refuses to use the source
database as the restore target.

```powershell
./scripts/verify-postgres-backup.ps1 `
  -SourceDatabaseUrl $env:BACKUP_DATABASE_URL `
  -RestoreDatabaseUrl $env:RESTORE_DATABASE_URL `
  -ConfirmRestoreTarget RESTORE_DEDICATED_TARGET
```

The drill creates a custom-format logical dump, restores with ownership/ACL stripped,
checks applied Prisma migrations and public tables, and deletes the temporary local dump.
Record the drill date and result in Task 19 before marking it complete.

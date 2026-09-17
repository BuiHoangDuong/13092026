import type { OperationalHealthResponse } from "@cashback/contracts";
import { db } from "@cashback/db";

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export async function getOperationalHealth(): Promise<OperationalHealthResponse> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const [jobGroups, oldestPending, heartbeat, totalImports, failedImports] = await Promise.all([
    db.job.groupBy({ by: ["state"], _count: { _all: true } }),
    db.job.findFirst({ where: { state: "PENDING" }, orderBy: { runAfter: "asc" }, select: { runAfter: true } }),
    db.workerHeartbeat.findFirst({ where: { stoppedAt: null }, orderBy: { lastSeenAt: "desc" }, select: { lastSeenAt: true } }),
    db.importBatch.count({ where: { createdAt: { gte: windowStart } } }),
    db.importBatch.count({ where: { createdAt: { gte: windowStart }, status: "FAILED" } })
  ]);
  const counts = new Map(jobGroups.map(group => [group.state, group._count._all]));
  const oldestPendingAgeSeconds = oldestPending ? Math.max(0, (now.getTime() - oldestPending.runAfter.getTime()) / 1000) : null;
  const workerAgeSeconds = heartbeat ? Math.max(0, (now.getTime() - heartbeat.lastSeenAt.getTime()) / 1000) : null;
  const workerStaleSeconds = positiveNumber(process.env.HEALTH_WORKER_STALE_SECONDS, 60);
  const oldestJobAlertSeconds = positiveNumber(process.env.HEALTH_OLDEST_JOB_ALERT_SECONDS, 300);
  const importErrorRateAlert = positiveNumber(process.env.HEALTH_IMPORT_ERROR_RATE_ALERT, 0.2);
  const importErrorRate = totalImports ? failedImports / totalImports : 0;
  const workerStatus = workerAgeSeconds === null ? "MISSING" as const : workerAgeSeconds > workerStaleSeconds ? "STALE" as const : "HEALTHY" as const;
  const alerts: OperationalHealthResponse["alerts"] = [];
  if (oldestPendingAgeSeconds !== null && oldestPendingAgeSeconds > oldestJobAlertSeconds) alerts.push("OLDEST_JOB");
  if (workerStatus !== "HEALTHY") alerts.push("WORKER_HEARTBEAT");
  if (totalImports > 0 && importErrorRate >= importErrorRateAlert) alerts.push("IMPORT_ERROR_RATE");
  return {
    ok: true, status: alerts.length ? "DEGRADED" : "OK", service: "web", checkedAt: now.toISOString(),
    database: { ok: true },
    queue: { pending: counts.get("PENDING") ?? 0, claimed: counts.get("CLAIMED") ?? 0, failed: counts.get("FAILED") ?? 0, oldestPendingAgeSeconds },
    worker: { status: workerStatus, lastHeartbeatAt: heartbeat?.lastSeenAt.toISOString() ?? null, ageSeconds: workerAgeSeconds },
    imports: { windowHours: 24, total: totalImports, failed: failedImports, errorRate: importErrorRate }, alerts
  };
}

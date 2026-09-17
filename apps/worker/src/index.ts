import { randomUUID } from "node:crypto";
import { claimNextJob, reapExpiredJobs, heartbeat, failJob, parseImportJob, publishImportJob, attributeJob, releaseHoldsJob, scheduleHoldRelease, recordWorkerHeartbeat, recordWorkerStopped, getOperationalHealth } from "@cashback/core";
import { db } from "@cashback/db";

const pollSeconds = Number(process.env.WORKER_POLL_SECONDS ?? 10);
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 120);
if (!Number.isFinite(pollSeconds) || pollSeconds < 1 || !Number.isFinite(leaseSeconds) || leaseSeconds < 10) throw new Error("Invalid worker timing configuration");
const workerId = process.env.RAILWAY_REPLICA_ID ?? process.env.WORKER_ID ?? randomUUID();
let stopping = false, lastSchedule = 0, lastHealthReport = 0, lastAlertAt = 0, lastAlertSignature = "";
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function tick() {
  await recordWorkerHeartbeat(workerId);
  await reapExpiredJobs();
  if (Date.now() - lastSchedule > 60_000) { await scheduleHoldRelease(); lastSchedule = Date.now(); }
  const job = await claimNextJob(leaseSeconds, workerId);
  if (!job?.lockedBy) return;
  const lease = { id: job.id, lockedBy: job.lockedBy };
  const timer = setInterval(() => { void Promise.all([heartbeat(lease, leaseSeconds), recordWorkerHeartbeat(workerId)]).catch(error => console.error("heartbeat_failed", error)); }, leaseSeconds * 1000 / 3);
  try {
    const payload = job.payload as Record<string, unknown>;
    if (job.type === "PARSE" && typeof payload.batchId === "string") await parseImportJob(lease, payload.batchId);
    else if (job.type === "PUBLISH" && typeof payload.batchId === "string") await publishImportJob(lease, payload.batchId);
    else if (job.type === "ATTRIBUTE" && typeof payload.exchangeId === "string") await attributeJob(lease, payload.exchangeId);
    else if (job.type === "RELEASE_HOLDS") await releaseHoldsJob(lease);
    else throw new Error(`NO_HANDLER:${job.type}`);
  } catch (error) { await failJob(lease, job.attempts, error); }
  finally { clearInterval(timer); }
}

async function reportOperationalHealth() {
  if (Date.now() - lastHealthReport < 60_000) return;
  lastHealthReport = Date.now();
  const health = await getOperationalHealth();
  console.log(JSON.stringify({ event: "operational_health", status: health.status, queue: health.queue, worker: health.worker, imports: health.imports }));
  const signature = health.alerts.join(",");
  if (!signature) { lastAlertSignature = ""; return; }
  if (signature === lastAlertSignature && Date.now() - lastAlertAt < 15 * 60_000) return;
  lastAlertSignature = signature; lastAlertAt = Date.now();
  const payload = { event: "cashback_operational_alert", checkedAt: health.checkedAt, alerts: health.alerts, queue: health.queue, worker: health.worker, imports: health.imports };
  console.error(JSON.stringify(payload));
  const webhook = process.env.OPERATIONS_ALERT_WEBHOOK_URL;
  if (webhook) {
    if (process.env.NODE_ENV === "production" && !webhook.startsWith("https://")) throw new Error("OPERATIONS_ALERT_WEBHOOK_URL must use HTTPS in production");
    const response = await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`Alert webhook returned ${response.status}`);
  }
}

async function main() {
  console.log(`Cashback worker polling every ${pollSeconds}s`);
  await recordWorkerHeartbeat(workerId, true);
  while (!stopping) {
    try { await tick(); await reportOperationalHealth(); } catch (error) { console.error("worker_tick_failed", error); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000));
  }
  await recordWorkerStopped(workerId);
  await db.$disconnect();
}
void main();

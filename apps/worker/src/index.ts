import { randomUUID } from "node:crypto";
import { claimNextJob, reapExpiredJobs, heartbeat, failJob, parseImportJob, publishImportJob, attributeJob, releaseHoldsJob, scheduleHoldRelease } from "@cashback/core";
import { db } from "@cashback/db";

const pollSeconds = Number(process.env.WORKER_POLL_SECONDS ?? 10);
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 120);
if (!Number.isFinite(pollSeconds) || pollSeconds < 1 || !Number.isFinite(leaseSeconds) || leaseSeconds < 10) throw new Error("Invalid worker timing configuration");
const workerId = randomUUID();
let stopping = false, lastSchedule = 0;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

async function tick() {
  await reapExpiredJobs();
  if (Date.now() - lastSchedule > 60_000) { await scheduleHoldRelease(); lastSchedule = Date.now(); }
  const job = await claimNextJob(leaseSeconds, workerId);
  if (!job?.lockedBy) return;
  const lease = { id: job.id, lockedBy: job.lockedBy };
  const timer = setInterval(() => { void heartbeat(lease, leaseSeconds).catch(error => console.error("heartbeat_failed", error)); }, leaseSeconds * 1000 / 3);
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

async function main() {
  console.log(`Cashback worker polling every ${pollSeconds}s`);
  while (!stopping) {
    try { await tick(); } catch (error) { console.error("worker_tick_failed", error); }
    if (!stopping) await new Promise(resolve => setTimeout(resolve, pollSeconds * 1000));
  }
  await db.$disconnect();
}
void main();

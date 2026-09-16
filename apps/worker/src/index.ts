import { claimNextJob, reapExpiredJobs } from "@cashback/core";
import { db, JobState } from "@cashback/db";

const pollSeconds = Number(process.env.WORKER_POLL_SECONDS ?? 10);
const leaseSeconds = Number(process.env.JOB_LEASE_SECONDS ?? 60);

async function handleJob(type: string) {
  // Concrete PARSE/PUBLISH/ATTRIBUTE/RELEASE handlers are registered as their tasks land.
  throw new Error(`NO_HANDLER:${type}`);
}

async function tick() {
  await reapExpiredJobs();
  const job = await claimNextJob(leaseSeconds);
  if (!job) return;
  try {
    await handleJob(job.type);
    await db.job.updateMany({ where: { id: job.id, state: JobState.CLAIMED }, data: { state: JobState.DONE, leaseUntil: null } });
  } catch (error) {
    await db.job.update({ where: { id: job.id }, data: {
      state: job.attempts >= 5 ? JobState.FAILED : JobState.PENDING,
      runAfter: new Date(Date.now() + Math.min(300, 2 ** job.attempts) * 1000),
      lastError: error instanceof Error ? error.message : String(error), leaseUntil: null
    } });
  }
}

console.log(`Cashback worker polling every ${pollSeconds}s`);
void tick();
setInterval(() => void tick(), pollSeconds * 1000);

import { db, JobState, Prisma } from "@cashback/db";

export async function claimNextJob(leaseSeconds: number) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Job"
      WHERE state = 'PENDING' AND "runAfter" <= NOW()
      ORDER BY "runAfter" LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    const job = rows[0];
    if (!job) return null;
    return tx.job.update({ where: { id: job.id }, data: {
      state: JobState.CLAIMED, attempts: { increment: 1 }, heartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + leaseSeconds * 1000)
    } });
  });
}

export async function heartbeat(jobId: string, leaseSeconds: number) {
  return db.job.updateMany({ where: { id: jobId, state: JobState.CLAIMED }, data: {
    heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + leaseSeconds * 1000)
  } });
}

export async function reapExpiredJobs() {
  return db.job.updateMany({ where: { state: JobState.CLAIMED, leaseUntil: { lt: new Date() } }, data: {
    state: JobState.PENDING, leaseUntil: null, heartbeatAt: null
  } });
}

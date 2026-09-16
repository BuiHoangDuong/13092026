import { randomUUID } from "node:crypto";
import { db, JobState, Prisma } from "@cashback/db";

export type JobLease = { id: string; lockedBy: string };

export async function claimNextJob(leaseSeconds: number, workerId = "worker") {
  if (!Number.isFinite(leaseSeconds) || leaseSeconds < 10) throw new Error("Invalid lease duration");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Job" WHERE state = 'PENDING' AND "runAfter" <= NOW() AND attempts < 5
      ORDER BY "runAfter", id LIMIT 1 FOR UPDATE SKIP LOCKED
    `);
    if (!rows[0]) return null;
    return tx.job.update({ where: { id: rows[0].id }, data: {
      state: JobState.CLAIMED, attempts: { increment: 1 }, heartbeatAt: new Date(),
      lockedBy: `${workerId}:${randomUUID()}`, leaseUntil: new Date(Date.now() + leaseSeconds * 1000)
    } });
  });
}

export async function heartbeat(lease: JobLease, leaseSeconds: number) {
  return db.job.updateMany({ where: { ...lease, state: JobState.CLAIMED, leaseUntil: { gt: new Date() } }, data: {
    heartbeatAt: new Date(), leaseUntil: new Date(Date.now() + leaseSeconds * 1000)
  } });
}

export async function reapExpiredJobs() {
  return db.$transaction([
    db.job.updateMany({ where: { state: JobState.CLAIMED, leaseUntil: { lt: new Date() }, attempts: { gte: 5 } }, data: {
      state: JobState.FAILED, lockedBy: null, leaseUntil: null, lastError: "LEASE_EXHAUSTED"
    } }),
    db.job.updateMany({ where: { state: JobState.CLAIMED, leaseUntil: { lt: new Date() }, attempts: { lt: 5 } }, data: {
      state: JobState.PENDING, lockedBy: null, leaseUntil: null, heartbeatAt: null
    } })
  ]);
}

/** Commit the result and DONE transition together. Expired owners roll back. */
export async function withJobLease<T>(lease: JobLease, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    const owned = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM "Job" WHERE id = ${lease.id} AND "lockedBy" = ${lease.lockedBy}
        AND state = 'CLAIMED' AND "leaseUntil" > clock_timestamp() FOR UPDATE
    `);
    if (!owned.length) throw new Error("LEASE_LOST");
    const result = await work(tx);
    const done = await tx.$executeRaw(Prisma.sql`
      UPDATE "Job" SET state = 'DONE', "lockedBy" = NULL, "leaseUntil" = NULL, "lastError" = NULL
      WHERE id = ${lease.id} AND "lockedBy" = ${lease.lockedBy} AND "leaseUntil" > clock_timestamp()
    `);
    if (done !== 1) throw new Error("LEASE_LOST");
    return result;
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function failJob(lease: JobLease, attempts: number, error: unknown) {
  return db.$transaction(async tx => {
    const updated = await tx.job.updateMany({ where: { ...lease, state: JobState.CLAIMED, leaseUntil: { gt: new Date() } }, data: {
    state: attempts >= 5 ? JobState.FAILED : JobState.PENDING, lockedBy: null, leaseUntil: null,
    runAfter: new Date(Date.now() + (Math.min(300, 2 ** attempts) + Math.random() * 5) * 1000),
    lastError: error instanceof Error ? error.message.slice(0, 1000) : "Job failed"
    } });
    if (updated.count && attempts >= 5) {
      const job = await tx.job.findUniqueOrThrow({ where: { id: lease.id } });
      const payload = job.payload as Record<string, unknown>;
      if (["PARSE", "PUBLISH"].includes(job.type) && typeof payload.batchId === "string") {
        const batch = await tx.importBatch.findUnique({ where: { id: payload.batchId } });
        if (batch && batch.status !== "PUBLISHED") await tx.importBatch.update({ where: { id: batch.id }, data: {
          status: "FAILED", totals: { ...(batch.totals as Record<string, Prisma.InputJsonValue> ?? {}), error: job.lastError }
        } });
      }
    }
    return updated;
  });
}

/** Low-volume MVP: serialize ledger/publish/UID decisions across workers. */
export async function lockCashback(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092026)`;
}

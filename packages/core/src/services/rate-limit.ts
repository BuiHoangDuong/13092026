import { createHash, randomUUID } from "node:crypto";
import { db, Prisma } from "@cashback/db";
export class PublicAccessError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400, public readonly retryAfter?: number) { super(message); }
}
export function positiveConfig(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new PublicAccessError("CONFIGURATION_ERROR", "Service temporarily unavailable", 503);
  return value;
}
export async function consumeBudget(scope: string, subject: string, windows: Array<{ seconds: number; limit: number }>) {
  const subjectHash = createHash("sha256").update(subject).digest("hex");
  const retry = await db.$transaction(async tx => {
    let retryAfter = 0;
    for (const { seconds, limit } of windows) {
      const start = Math.floor(Date.now() / (seconds * 1000)) * seconds * 1000;
      const rows = await tx.$queryRaw<Array<{ count: number }>>(Prisma.sql`
        INSERT INTO "RateLimitCounter" (id, scope, "subjectHash", "windowStart", count)
        VALUES (${randomUUID()}, ${scope}, ${subjectHash}, ${new Date(start)}, 1)
        ON CONFLICT (scope, "subjectHash", "windowStart") DO UPDATE
        SET count = LEAST("RateLimitCounter".count + 1, ${limit + 1}) RETURNING count
      `);
      if (rows[0]!.count > limit) retryAfter = Math.max(retryAfter, Math.ceil((start + seconds * 1000 - Date.now()) / 1000));
    }
    return retryAfter;
  });
  if (retry) throw new PublicAccessError("RATE_LIMITED", "Too many requests. Please try again later.", 429, retry);
}

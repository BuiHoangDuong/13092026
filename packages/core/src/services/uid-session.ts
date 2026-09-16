import { createHash, randomBytes } from "node:crypto";
import { db, type Prisma } from "@cashback/db";
import { PublicAccessError } from "./rate-limit.js";
export const uidTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
export async function issueUidSession(tx: Prisma.TransactionClient, uidAccountId: string) {
  const token = randomBytes(32).toString("base64url");
  await tx.uidSession.create({ data: { uidAccountId, tokenHash: uidTokenHash(token), expiresAt: new Date(Date.now() + 30 * 60_000) } });
  return token;
}
export async function requireUidSession(token?: string) {
  if (!token || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw new PublicAccessError("UNAUTHENTICATED", "Verify your email to continue", 401);
  const session = await db.uidSession.findUnique({ where: { tokenHash: uidTokenHash(token) }, include: { uidAccount: true } });
  if (!session || session.expiresAt <= new Date() || !session.uidAccount.boundEmail) throw new PublicAccessError("UNAUTHENTICATED", "Verify your email to continue", 401);
  return { uidAccountId: session.uidAccountId, exchangeId: session.uidAccount.exchangeId, uid: session.uidAccount.uid, email: session.uidAccount.boundEmail };
}

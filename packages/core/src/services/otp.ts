import { createHash, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { otpRequestSchema, otpVerifySchema } from "@cashback/contracts";
import { db, Prisma } from "@cashback/db";
import { consumeBudget, positiveConfig, PublicAccessError } from "./rate-limit.js";
import { resendEmailAdapter, type EmailPort } from "./email.js";
import { issueUidSession } from "./uid-session.js";
const emailFailure = () => new PublicAccessError("EMAIL_UNAVAILABLE", "Email delivery temporarily unavailable. Please try again later.", 503);
export async function requestOtp(raw: unknown, ip: string, emailPort: EmailPort = resendEmailAdapter) {
  const input = otpRequestSchema.parse(raw);
  await consumeBudget("otp:ip", ip, [{ seconds: 60, limit: positiveConfig("OTP_IP_PER_MINUTE", 5) }, { seconds: 3600, limit: positiveConfig("OTP_IP_PER_HOUR", 30) }]);
  const account = await db.uidAccount.findUnique({ where: { exchangeId_uid: { exchangeId: input.exchangeId, uid: input.uid } }, select: { id: true } });
  if (!account) throw new PublicAccessError("UID_NOT_FOUND", "No cashback account found for this exchange and UID", 404);
  const code = String(randomInt(100000, 1_000_000)); const codeHash = await bcrypt.hash(code, 12);
  const otp = await db.$transaction(async tx => {
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "UidAccount" WHERE id = ${account.id} FOR UPDATE`);
    const current = await tx.uidAccount.findUniqueOrThrow({ where: { id: account.id } });
    if (current.boundEmail && current.boundEmail !== input.email) throw new PublicAccessError("EMAIL_MISMATCH", "Email does not match the one registered for this UID", 403);
    const latest = await tx.emailOtp.findFirst({ where: { uidAccountId: account.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
    const cooldown = positiveConfig("OTP_COOLDOWN_SECONDS", 60);
    const remaining = latest ? Math.ceil((latest.createdAt.getTime() + cooldown * 1000 - Date.now()) / 1000) : 0;
    if (remaining > 0) throw new PublicAccessError("OTP_COOLDOWN", "Please wait before requesting another code", 429, remaining);
    const cap = positiveConfig("OTP_DAILY_CAP", 5);
    const windowStart = new Date(Math.floor(Date.now() / 86400_000) * 86400_000);
    const subjectHash = createHash("sha256").update(account.id).digest("hex");
    const budget = await tx.rateLimitCounter.upsert({
      where: { scope_subjectHash_windowStart: { scope: "otp:uid", subjectHash, windowStart } },
      create: { scope: "otp:uid", subjectHash, windowStart, count: 1 }, update: { count: { increment: 1 } }
    });
    if (budget.count > cap) throw new PublicAccessError("RATE_LIMITED", "Daily verification code limit reached", 429, Math.ceil((windowStart.getTime() + 86400_000 - Date.now()) / 1000));
    await tx.emailOtp.updateMany({ where: { uidAccountId: account.id, consumedAt: null }, data: { consumedAt: new Date() } });
    return tx.emailOtp.create({ data: { uidAccountId: account.id, email: current.boundEmail ?? input.email, codeHash, expiresAt: new Date(Date.now() + positiveConfig("OTP_TTL_MINUTES", 5) * 60_000) } });
  });
  try {
    const result = await emailPort.sendOtp({ to: otp.email, code, requestId: otp.id });
    if (!result.accepted) throw emailFailure();
    await db.emailOtp.update({ where: { id: otp.id }, data: { providerAccepted: true, providerMessageId: result.messageId } });
  } catch { throw emailFailure(); }
  return { otpId: otp.id, expiresAt: otp.expiresAt.toISOString() };
}
export async function verifyOtp(raw: unknown, ip: string) {
  const input = otpVerifySchema.parse(raw);
  await consumeBudget("otp:verify:ip", ip, [{ seconds: 60, limit: positiveConfig("OTP_VERIFY_IP_PER_MINUTE", 30) }]);
  const found = await db.emailOtp.findUnique({ where: { id: input.otpId }, select: { uidAccountId: true } });
  if (!found) throw new PublicAccessError("INVALID_OTP", "Invalid or expired verification code", 400);
  const result = await db.$transaction(async tx => {
    // Same lock order as resend: UID account first, then its OTP.
    await tx.$queryRaw(Prisma.sql`SELECT id FROM "UidAccount" WHERE id = ${found.uidAccountId} FOR UPDATE`);
    const otp = await tx.emailOtp.findUniqueOrThrow({ where: { id: input.otpId } });
    const max = positiveConfig("OTP_MAX_ATTEMPTS", 5);
    if (!otp.providerAccepted || otp.consumedAt || otp.expiresAt <= new Date() || otp.failedAttempts >= max) return null;
    if (!await bcrypt.compare(input.code, otp.codeHash)) {
      const attempts = otp.failedAttempts + 1;
      await tx.emailOtp.update({ where: { id: otp.id }, data: { failedAttempts: attempts, ...(attempts >= max ? { consumedAt: new Date() } : {}) } });
      return null; // Commit the failed guess; throwing here would roll it back.
    }
    const account = await tx.uidAccount.findUniqueOrThrow({ where: { id: found.uidAccountId } });
    if (otp.expiresAt <= new Date()) return null;
    if (account.boundEmail && account.boundEmail !== otp.email) return null;
    await tx.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    if (!account.boundEmail) await tx.uidAccount.update({ where: { id: account.id }, data: { boundEmail: otp.email, emailBoundAt: new Date() } });
    return { token: await issueUidSession(tx, account.id) };
  }, { timeout: 15000 });
  if (!result) throw new PublicAccessError("INVALID_OTP", "Invalid or expired verification code", 400);
  return result;
}

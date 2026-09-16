import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@cashback/db";
export type Principal = { type: "ADMIN"; id: string; email: string };
export type AuthPort = { getSession(token?: string): Promise<Principal | null>; requireAdmin(token?: string): Promise<Principal> };
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export async function createSession(adminId: string) {
  const token = randomBytes(32).toString("base64url");
  await db.session.create({ data: { adminId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 24 * 3_600_000) } }); return token;
}
export async function login(email: string, password: string) {
  const account = await db.adminAccount.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!account?.passwordHash || !(await bcrypt.compare(password, account.passwordHash))) return null;
  return { account, token: await createSession(account.id) };
}
export async function logout(token?: string) { if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } }); }
export const auth: AuthPort = {
  async getSession(token) {
    if (!token) return null;
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { admin: true } });
    return session && session.expiresAt > new Date() ? { type: "ADMIN", id: session.admin.id, email: session.admin.email } : null;
  },
  async requireAdmin(token) { const principal = await this.getSession(token); if (!principal) throw new Error("UNAUTHENTICATED"); return principal; }
};

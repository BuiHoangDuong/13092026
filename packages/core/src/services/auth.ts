import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, PrincipalType } from "@cashback/db";

export type Principal = { type: "CUSTOMER" | "ADMIN"; id: string; email: string };
export type AuthPort = {
  getSession(token?: string): Promise<Principal | null>;
  requireCustomer(token?: string): Promise<Principal & { type: "CUSTOMER" }>;
  requireAdmin(token?: string): Promise<Principal & { type: "ADMIN" }>;
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(principalType: PrincipalType, subjectId: string) {
  const token = randomBytes(32).toString("base64url");
  const ttlHours = Number(process.env.SESSION_TTL_HOURS ?? 168);
  await db.session.create({ data: { principalType, subjectId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlHours * 3_600_000) } });
  return token;
}

export async function registerCustomer(email: string, password: string, locale = "en") {
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 12);
  const customer = await db.customer.create({ data: { email: normalizedEmail, passwordHash, locale } });
  return { customer, token: await createSession(PrincipalType.CUSTOMER, customer.id) };
}

export async function login(email: string, password: string, type: PrincipalType) {
  const normalizedEmail = email.trim().toLowerCase();
  const account = type === PrincipalType.CUSTOMER
    ? await db.customer.findUnique({ where: { email: normalizedEmail } })
    : await db.adminAccount.findUnique({ where: { email: normalizedEmail } });
  if (!account?.passwordHash || !(await bcrypt.compare(password, account.passwordHash))) return null;
  return { account, token: await createSession(type, account.id) };
}

export async function logout(token?: string) {
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export const auth: AuthPort = {
  async getSession(token) {
    if (!token) return null;
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!session || session.expiresAt <= new Date()) return null;
    if (session.principalType === PrincipalType.CUSTOMER) {
      const customer = await db.customer.findUnique({ where: { id: session.subjectId } });
      return customer ? { type: "CUSTOMER", id: customer.id, email: customer.email } : null;
    }
    const admin = await db.adminAccount.findUnique({ where: { id: session.subjectId } });
    return admin ? { type: "ADMIN", id: admin.id, email: admin.email } : null;
  },
  async requireCustomer(token) {
    const principal = await this.getSession(token);
    if (!principal) throw new Error("UNAUTHENTICATED");
    if (principal.type !== "CUSTOMER") throw new Error("FORBIDDEN");
    return principal as Principal & { type: "CUSTOMER" };
  },
  async requireAdmin(token) {
    const principal = await this.getSession(token);
    if (!principal) throw new Error("UNAUTHENTICATED");
    if (principal.type !== "ADMIN") throw new Error("FORBIDDEN");
    return principal as Principal & { type: "ADMIN" };
  }
};

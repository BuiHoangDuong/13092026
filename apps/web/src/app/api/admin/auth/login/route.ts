import { loginSchema } from "@cashback/contracts";
import { login } from "@cashback/core";
import { sessionCookieName } from "@/lib/auth";
import { adminJson } from "@/lib/admin-api";
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(process.env.APP_URL || request.url).origin) return adminJson({ error: { code: "FORBIDDEN", message: "Invalid origin" } }, { status: 403 });
  let input;
  try { input = loginSchema.parse(await request.json()); } catch { return adminJson({ error: { code: "VALIDATION_ERROR", message: "Invalid login" } }, { status: 400 }); }
  const result = await login(input.email, input.password);
  if (!result) return adminJson({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }, { status: 401 });
  const response = adminJson({ ok: true });
  response.cookies.set(sessionCookieName, result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 86400 });
  return response;
}

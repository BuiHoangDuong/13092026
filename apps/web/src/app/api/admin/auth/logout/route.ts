import { logout } from "@cashback/core";
import { sessionCookieName, sessionToken } from "@/lib/auth";
import { adminJson } from "@/lib/admin-api";
export async function POST(request: Request) {
  if (request.headers.get("origin") && request.headers.get("origin") !== new URL(process.env.APP_URL || request.url).origin) return adminJson({ error: { code: "FORBIDDEN", message: "Invalid origin" } }, { status: 403 });
  await logout(await sessionToken());
  const response = adminJson({ ok: true }); response.cookies.delete(sessionCookieName); return response;
}

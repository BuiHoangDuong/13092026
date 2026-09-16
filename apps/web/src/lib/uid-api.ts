import { cookies } from "next/headers";
import { requireUidSession, PublicAccessError } from "@cashback/core";
export const uidCookieName = "cashback_uid_session";
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(process.env.APP_URL || request.url).origin) throw new PublicAccessError("FORBIDDEN", "Invalid request origin", 403);
}
export async function uidPrincipal(request: Request) {
  const principal = await requireUidSession((await cookies()).get(uidCookieName)?.value);
  const query = new URL(request.url).searchParams;
  // No endpoint accepts a caller-selected UID principal.
  for (const key of ["uidAccountId", "exchangeId", "uid"]) if (query.has(key)) throw new PublicAccessError("FORBIDDEN", "UID scope is determined by your session", 403);
  if (request.method !== "GET") sameOrigin(request);
  return principal;
}

import { isIP } from "node:net";
import { PublicAccessError } from "@cashback/core";
import { ZodError } from "zod";
import { NextResponse } from "next/server";
export function privateJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { "Cache-Control": "private, no-store", Vary: "Cookie", ...init.headers } });
}
export function clientIp(request: Request) {
  // Configure only a header overwritten by the trusted ingress.
  const header = process.env.CLIENT_IP_HEADER;
  if (!header) {
    if (process.env.NODE_ENV === "production") throw new PublicAccessError("CONFIGURATION_ERROR", "Service temporarily unavailable", 503);
    return "local";
  }
  const value = request.headers.get(header)?.split(",").at(-1)?.trim();
  if (!value || !isIP(value)) throw new PublicAccessError("CLIENT_IP_UNAVAILABLE", "Service temporarily unavailable", 503);
  return value;
}
export async function publicAccess(handler: () => Promise<Response>) {
  try { return await handler(); } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return privateJson({ error: { code: "VALIDATION_ERROR", message: "Invalid request" } }, { status: 400 });
    if (error instanceof PublicAccessError) return privateJson({ error: { code: error.code, message: error.message } }, { status: error.status, headers: error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {} });
    if (error instanceof Error && "code" in error && error.code === "INVALID_HISTORY_CURSOR") return privateJson({ error: { code: "VALIDATION_ERROR", message: "Invalid history cursor" } }, { status: 400 });
    return privateJson({ error: { code: "INTERNAL_ERROR", message: "Service temporarily unavailable" } }, { status: 503 });
  }
}

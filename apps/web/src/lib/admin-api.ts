import { ZodError, type ZodType } from "zod";
import { auth, PublicAccessError, type Principal } from "@cashback/core";
import { NextResponse } from "next/server";
import { sessionToken } from "./auth";

const privateHeaders = { "Cache-Control": "private, no-store" };

export function adminJson(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, { ...init, headers: { ...privateHeaders, ...init.headers } });
}

export async function parseAdminRequest<T>(request: Request, schema: ZodType<T>): Promise<T> {
  return schema.parse(await request.json());
}

export function adminListOptions(request: Request) {
  const params = new URL(request.url).searchParams;
  const parsedLimit = Number(params.get("limit") ?? 50);
  return { cursor: params.get("cursor") ?? undefined, limit: Number.isFinite(parsedLimit) ? parsedLimit : 50 };
}

export async function withAdmin(handler: (principal: Principal) => Promise<Response>): Promise<Response> {
  try {
    const principal = await auth.requireAdmin(await sessionToken());
    return await handler(principal);
  } catch (error) {
    if (error instanceof PublicAccessError) return adminJson({ error: { code: error.code, message: error.message } }, { status: error.status });
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return adminJson({ error: { code: "VALIDATION_ERROR", message: "Invalid request", details: error instanceof ZodError ? error.issues : undefined } }, { status: 400 });
    }
    const domainCode = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (domainCode && ["CONTENT_NOT_FOUND", "CONTENT_CONFLICT", "OFFER_EXCHANGE_MISMATCH", "INVALID_REFERENCE"].includes(domainCode)) {
      const status = domainCode === "CONTENT_NOT_FOUND" ? 404 : domainCode === "INVALID_REFERENCE" ? 400 : 409;
      const message = error instanceof Error ? error.message : "Content operation failed";
      return adminJson({ error: { code: domainCode, message } }, { status });
    }
    if (domainCode && ["IMPORT_INVALID", "IMPORT_NOT_FOUND"].includes(domainCode)) {
      const message = error instanceof Error ? error.message : "Import operation failed";
      return adminJson({ error: { code: domainCode, message } }, { status: domainCode === "IMPORT_NOT_FOUND" ? 404 : 400 });
    }
    if (error instanceof Error && ["INVALID_CURSOR", "ACCOUNT_NOT_FOUND"].includes(error.message)) {
      return adminJson({ error: { code: error.message, message: error.message === "ACCOUNT_NOT_FOUND" ? "UID account not found" : "Invalid activity cursor" } }, { status: error.message === "ACCOUNT_NOT_FOUND" ? 404 : 400 });
    }
    if (error instanceof Error && (error.message === "UNAUTHENTICATED" || error.message === "UNAUTHORIZED_ADMIN")) {
      return adminJson({ error: { code: "UNAUTHORIZED", message: "Admin authentication required" } }, { status: 401 });
    }
    if (error instanceof Error && error.message === "FORBIDDEN") {
      return adminJson({ error: { code: "FORBIDDEN", message: "Admin access required" } }, { status: 403 });
    }
    console.error(error);
    return adminJson({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } }, { status: 500 });
  }
}

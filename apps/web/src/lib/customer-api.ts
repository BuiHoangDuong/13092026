import { ZodError } from "zod";
import { auth } from "@cashback/core";
import { NextResponse } from "next/server";
import { sessionToken } from "./auth";

export const customerJson = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" }
});

export async function withCustomer(request: Request, handler: (customerId: string) => Promise<Response>) {
  try {
    const principal = await auth.requireCustomer(await sessionToken());
    const origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && origin !== new URL(request.url).origin) return customerJson({ error: { message: "Invalid request origin" } }, 403);
    return await handler(principal.id);
  } catch (error) {
    if (error instanceof ZodError || error instanceof SyntaxError) return customerJson({ error: { message: "Invalid request" } }, 400);
    if (error instanceof Error && error.message === "UNAUTHENTICATED") return customerJson({ error: { message: "Sign in to view your cashback" } }, 401);
    if (error instanceof Error && error.message === "FORBIDDEN") return customerJson({ error: { message: "Customer account required" } }, 403);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (["INVALID_UID_LINK", "UID_NOT_FOUND", "UID_CONFLICT"].includes(code)) return customerJson({ error: { code, message: error instanceof Error ? error.message : "UID request failed" } }, code === "UID_NOT_FOUND" ? 404 : code === "UID_CONFLICT" ? 409 : 400);
    console.error("customer_api_failed", error);
    return customerJson({ error: { message: "Cashback is temporarily unavailable. Please try again." } }, 503);
  }
}

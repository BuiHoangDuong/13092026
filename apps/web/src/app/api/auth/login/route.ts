import { loginSchema } from "@cashback/contracts";
import { login } from "@cashback/core";
import { PrincipalType } from "@cashback/db";
import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth";

export async function POST(request: Request) {
  const raw = await request.json();
  const input = loginSchema.safeParse(raw);
  if (!input.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid login" } }, { status: 400 });
  const result = await login(input.data.email, input.data.password, raw.role === "ADMIN" ? PrincipalType.ADMIN : PrincipalType.CUSTOMER);
  if (!result) return NextResponse.json({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }, { status: 401 });
  const response = NextResponse.json({ account: { id: result.account.id, email: result.account.email } });
  response.cookies.set(sessionCookieName, result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
  return response;
}

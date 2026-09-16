import { registerSchema } from "@cashback/contracts";
import { registerCustomer } from "@cashback/core";
import { NextResponse } from "next/server";
import { sessionCookieName } from "@/lib/auth";

export async function POST(request: Request) {
  const input = registerSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: { code: "VALIDATION_ERROR", message: "Invalid registration", details: input.error.flatten() } }, { status: 400 });
  try {
    const { customer, token } = await registerCustomer(input.data.email, input.data.password, input.data.locale);
    const response = NextResponse.json({ customer: { id: customer.id, email: customer.email } }, { status: 201 });
    response.cookies.set(sessionCookieName, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    return response;
  } catch { return NextResponse.json({ error: { code: "EMAIL_EXISTS", message: "Email is already registered" } }, { status: 409 }); }
}

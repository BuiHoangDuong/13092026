import { logout } from "@cashback/core";
import { NextResponse } from "next/server";
import { sessionCookieName, sessionToken } from "@/lib/auth";

export async function POST() {
  await logout(await sessionToken());
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(sessionCookieName);
  return response;
}

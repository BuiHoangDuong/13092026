import { NextResponse } from "next/server";
import { getOperationalHealth } from "@cashback/core";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getOperationalHealth(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("healthcheck_failed", error);
    return NextResponse.json({ ok: false, status: "DEGRADED", service: "web", database: { ok: false } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

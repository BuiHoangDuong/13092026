import { listPublishedExchanges } from "@cashback/core";
import { NextResponse } from "next/server";
import { defaultLocale, isLocale } from "../../../i18n";

export async function GET(request: Request) {
  const requested = new URL(request.url).searchParams.get("locale") ?? defaultLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;
  return NextResponse.json({ exchanges: await listPublishedExchanges(locale) }, { headers: { "Cache-Control": "public, s-maxage=60" } });
}

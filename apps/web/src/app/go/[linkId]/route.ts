import { recordClick, resolveReferralLink } from "@cashback/core";
import { after, NextResponse } from "next/server";

export async function GET(request: Request, { params }: { params: Promise<{ linkId: string }> }) {
  const { linkId } = await params;
  const link = await resolveReferralLink(linkId);
  if (!link) return NextResponse.redirect(new URL("/exchanges", request.url), 302);
  after(async () => { try { await recordClick(link.id); } catch (error) { console.error("click_record_failed", error); } });
  return NextResponse.redirect(link.destination, 302);
}

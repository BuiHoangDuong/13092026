import { listWithdrawals, requestWithdrawal } from "@cashback/core";
import { privateJson, publicAccess } from "@/lib/public-access-api";
import { uidPrincipal } from "@/lib/uid-api";
export async function GET(request: Request) {
  return publicAccess(async () => { const p = await uidPrincipal(request); return privateJson(await listWithdrawals(p.uidAccountId, new URL(request.url).searchParams.get("cursor") ?? undefined)); });
}
export async function POST(request: Request) {
  return publicAccess(async () => { const p = await uidPrincipal(request); return privateJson(await requestWithdrawal(p, await request.json()), { status: 201 }); });
}

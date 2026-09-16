import { cancelWithdrawal } from "@cashback/core";
import { privateJson, publicAccess } from "@/lib/public-access-api";
import { uidPrincipal } from "@/lib/uid-api";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return publicAccess(async () => { const p = await uidPrincipal(request); return privateJson(await cancelWithdrawal(p.uidAccountId, (await context.params).id)); });
}

import { getWallet } from "@cashback/core";
import { privateJson, publicAccess } from "@/lib/public-access-api";
import { uidPrincipal } from "@/lib/uid-api";
export async function GET(request: Request) {
  return publicAccess(async () => {
    const principal = await uidPrincipal(request);
    return privateJson(await getWallet(principal.uidAccountId, new URL(request.url).searchParams.get("cursor") ?? undefined));
  });
}

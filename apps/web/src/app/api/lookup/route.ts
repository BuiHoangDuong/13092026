import { lookupCashback } from "@cashback/core";
import { lookupRequestSchema } from "@cashback/contracts";
import { clientIp, privateJson, publicAccess } from "@/lib/public-access-api";
export async function POST(request: Request) {
  return publicAccess(async () => {
    const input = lookupRequestSchema.parse(await request.json());
    return privateJson(await lookupCashback(input, clientIp(request)));
  });
}

import { otpRequestSchema } from "@cashback/contracts";
import { requestOtp } from "@cashback/core";
import { clientIp, privateJson, publicAccess } from "@/lib/public-access-api";
import { sameOrigin } from "@/lib/uid-api";
export async function POST(request: Request) {
  return publicAccess(async () => { sameOrigin(request); const input = otpRequestSchema.parse(await request.json()); return privateJson(await requestOtp(input, clientIp(request))); });
}

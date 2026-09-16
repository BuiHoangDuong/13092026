import { otpVerifySchema } from "@cashback/contracts";
import { verifyOtp } from "@cashback/core";
import { clientIp, privateJson, publicAccess } from "@/lib/public-access-api";
import { sameOrigin, uidCookieName } from "@/lib/uid-api";
export async function POST(request: Request) {
  return publicAccess(async () => {
    sameOrigin(request); const input = otpVerifySchema.parse(await request.json());
    const result = await verifyOtp(input, clientIp(request));
    const response = privateJson({ ok: true });
    response.cookies.set(uidCookieName, result.token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 1800 });
    return response;
  });
}

import { db } from "@cashback/db";
import { uidTokenHash } from "@cashback/core";
import { cookies } from "next/headers";
import { privateJson, publicAccess } from "@/lib/public-access-api";
import { sameOrigin, uidCookieName } from "@/lib/uid-api";
export async function POST(request: Request) {
  return publicAccess(async () => {
    sameOrigin(request); const token = (await cookies()).get(uidCookieName)?.value;
    if (token) await db.uidSession.deleteMany({ where: { tokenHash: uidTokenHash(token) } });
    const response = privateJson({ ok: true }); response.cookies.delete(uidCookieName); return response;
  });
}

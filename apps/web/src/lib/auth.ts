import { cookies } from "next/headers";

export const sessionCookieName = process.env.SESSION_COOKIE_NAME ?? "cashback_session";
export async function sessionToken() { return (await cookies()).get(sessionCookieName)?.value; }

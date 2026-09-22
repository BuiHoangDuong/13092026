import { cookies } from "next/headers";
import { sessionCookieName } from "./session-cookie";

export { sessionCookieName };
export async function sessionToken() { return (await cookies()).get(sessionCookieName)?.value; }

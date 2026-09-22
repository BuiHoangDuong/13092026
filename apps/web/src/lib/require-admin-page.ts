import { auth } from "@cashback/core";
import { redirect } from "next/navigation";
import { sessionToken } from "./auth";

/** Reject inside the page itself. A layout redirect does not stop the RSC page slot. */
export async function requireAdminPage() {
  const principal = await auth.getSession(await sessionToken());
  if (!principal || principal.type !== "ADMIN") redirect("/admin/login");
  return principal;
}

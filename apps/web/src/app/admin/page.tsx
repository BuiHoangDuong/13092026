import { auth } from "@cashback/core";
import { redirect } from "next/navigation";
import { sessionToken } from "@/lib/auth";
import { AdminContentManager } from "./admin-content-manager";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const principal = await auth.getSession(await sessionToken());
  if (!principal || principal.type !== "ADMIN") redirect("/login");
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">Operations</p>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Admin content.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Create, edit, publish, or unpublish exchanges, offers, referral links, and guides.
      </p>
      <AdminContentManager />
    </main>
  );
}

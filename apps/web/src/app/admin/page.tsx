import { auth } from "@cashback/core";
import { redirect } from "next/navigation";
import { sessionToken } from "@/lib/auth";
import { AdminContentManager } from "./admin-content-manager";
import { BybitOperations } from "./bybit-operations";
import { WithdrawalQueue } from "./withdrawal-queue";
import { AnalyticsDashboard } from "./analytics-dashboard";
import { db } from "@cashback/db";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const principal = await auth.getSession(await sessionToken());
  if (!principal || principal.type !== "ADMIN") redirect("/admin/login");
  const bybit = await db.exchange.findFirst({ where: { slug: "bybit", status: "PUBLISHED" }, select: { id: true } });
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">Operations</p>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Admin content.</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
        Create, edit, publish, or unpublish exchanges, offers, referral links, and guides.
      </p>
      <AnalyticsDashboard />
      <BybitOperations exchangeId={bybit?.id ?? null} />
      <WithdrawalQueue />
      <AdminContentManager />
    </main>
  );
}

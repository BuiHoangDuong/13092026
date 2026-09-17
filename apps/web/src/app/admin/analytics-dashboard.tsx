"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Activity, Clock3, Link2, MousePointerClick } from "lucide-react";
import { adminAnalyticsResponseSchema, adminSyncStatusResponseSchema, type AdminAnalyticsResponse, type AdminSyncStatusResponse } from "@cashback/contracts";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";

type LinkMetric = AdminAnalyticsResponse["links"][number];
type ImportStatus = AdminSyncStatusResponse["imports"][number];

async function responseJson(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Dashboard data is unavailable");
  return body;
}

export function AnalyticsDashboard() {
  const [analytics, setAnalytics] = useState<AdminAnalyticsResponse | null>(null);
  const [sync, setSync] = useState<AdminSyncStatusResponse | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [analyticsBody, syncBody] = await Promise.all([
        fetch("/api/admin/analytics?days=30", { cache: "no-store" }).then(responseJson),
        fetch("/api/admin/sync-status", { cache: "no-store" }).then(responseJson)
      ]);
      setAnalytics(adminAnalyticsResponseSchema.parse(analyticsBody));
      setSync(adminSyncStatusResponseSchema.parse(syncBody));
      setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Dashboard data is unavailable"); }
  }, []);

  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000); return () => clearInterval(timer); }, [refresh]);

  const linkColumns = useMemo<ColumnDef<LinkMetric>[]>(() => [
    { accessorKey: "exchange", header: ({ column }) => <DataTableColumnHeader column={column} title="Exchange" /> },
    { accessorKey: "destination", header: "Destination", cell: ({ row }) => <span className="block max-w-72 truncate" title={row.original.destination}>{row.original.destination}</span> },
    { accessorKey: "clicks", header: ({ column }) => <DataTableColumnHeader column={column} title="Clicks" /> }
  ], []);
  const importColumns = useMemo<ColumnDef<ImportStatus>[]>(() => [
    { accessorKey: "exchange", header: ({ column }) => <DataTableColumnHeader column={column} title="Exchange" /> },
    { accessorKey: "rootAccount", header: ({ column }) => <DataTableColumnHeader column={column} title="Root account" /> },
    { accessorKey: "status", filterFn: "equals", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" /> },
    { accessorKey: "createdAt", header: ({ column }) => <DataTableColumnHeader column={column} title="Created" />, cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() },
    { accessorKey: "sourceAsOf", header: "Source as of", cell: ({ row }) => row.original.sourceAsOf ? new Date(row.original.sourceAsOf).toLocaleString() : "Not provided" }
  ], []);
  const maxDaily = Math.max(1, ...(analytics?.clicksByDay.map(point => point.clicks) ?? []));
  const attributed = analytics?.attribution.reduce((sum, row) => sum + row.attributedRecords, 0) ?? 0;
  const unattributed = analytics?.attribution.reduce((sum, row) => sum + row.unattributedRecords, 0) ?? 0;
  const activeJobs = sync?.jobs.filter(job => job.state === "PENDING" || job.state === "CLAIMED").reduce((sum, job) => sum + job.count, 0) ?? 0;

  return <section className="mt-10 space-y-6">
    <div><h2 className="text-2xl font-semibold">Analytics and sync health</h2><p className="mt-1 text-sm text-muted-foreground">Internal click, attribution, import, and worker state. Refreshes every 30 seconds while this tab is visible.</p></div>
    {error && <p role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Metric icon={<MousePointerClick />} label="Clicks, last 30 days" value={String(analytics?.totalClicks ?? 0)} />
      <Metric icon={<Link2 />} label="Attributed records" value={String(attributed)} detail={`${unattributed} unattributed`} />
      <Metric icon={<Activity />} label="Active jobs" value={String(activeJobs)} detail={sync?.apiSync.enabled ? sync.apiSync.state : "API sync disabled"} />
      <Metric icon={<Clock3 />} label="Last published import" value={sync?.lastSuccessfulImportAt ? new Date(sync.lastSuccessfulImportAt).toLocaleDateString() : "None"} detail={sync?.sourceAsOf ? `Source: ${new Date(sync.sourceAsOf).toLocaleString()}` : "No source as-of"} />
    </div>
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="rounded-lg border border-border bg-card p-5"><h3 className="font-semibold">Click activity by day</h3><div className="mt-5 flex h-44 items-end gap-1" aria-label="Daily click chart">{analytics?.clicksByDay.length ? analytics.clicksByDay.map(point => <div key={point.day} className="group flex min-w-0 flex-1 flex-col items-center justify-end gap-1"><span className="text-[10px] text-muted-foreground opacity-0 group-hover:opacity-100">{point.clicks}</span><div className="w-full bg-primary" style={{ height: `${Math.max(3, point.clicks / maxDaily * 130)}px` }} title={`${point.day}: ${point.clicks} clicks`} /><span className="hidden text-[10px] text-muted-foreground sm:block">{point.day.slice(5)}</span></div>) : <p className="self-center text-sm text-muted-foreground">No clicks in this range.</p>}</div></section>
      <section className="rounded-lg border border-border bg-card p-5"><h3 className="font-semibold">Clicks by exchange</h3><div className="mt-5 space-y-4">{analytics?.exchanges.map(exchange => <div key={exchange.exchangeId}><div className="mb-1 flex justify-between text-sm"><span>{exchange.exchange}</span><span>{exchange.clicks}</span></div><div className="h-2 bg-muted"><div className="h-full bg-success" style={{ width: `${analytics.totalClicks ? exchange.clicks / analytics.totalClicks * 100 : 0}%` }} /></div></div>)}</div></section>
    </div>
    <section className="rounded-lg border border-border bg-card p-5"><h3 className="mb-4 font-semibold">Attribution by exchange</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-muted-foreground"><tr><th className="p-2">Exchange</th><th className="p-2">Attributed</th><th className="p-2">Unattributed</th><th className="p-2">Attributed commission</th><th className="p-2">Unattributed commission</th><th className="p-2">Cashback credited</th></tr></thead><tbody>{analytics?.attribution.map(row => <tr className="border-t border-border" key={row.exchangeId}><td className="p-2 font-medium">{row.exchange}</td><td className="p-2">{row.attributedRecords}</td><td className="p-2">{row.unattributedRecords}</td><td className="p-2">{row.attributedCommission}</td><td className="p-2">{row.unattributedCommission}</td><td className="p-2">{row.creditedCashback}</td></tr>)}</tbody></table></div></section>
    <section className="rounded-lg border border-border bg-card p-5"><h3 className="mb-4 font-semibold">Referral link performance</h3><DataTable data={analytics?.links ?? []} columns={linkColumns} searchKey="destination" searchPlaceholder="Filter destinations..." /></section>
    <section className="rounded-lg border border-border bg-card p-5"><h3 className="mb-4 font-semibold">Import and source status</h3><DataTable data={sync?.imports ?? []} columns={importColumns} searchKey="rootAccount" searchPlaceholder="Filter imports..." filters={[{ columnId: "status", title: "Status", options: ["UPLOADED","PARSING","PREVIEW","COMMITTING","PUBLISHED","FAILED"].map(value => ({ value, label: value })) }]} /></section>
  </section>;
}

function Metric({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: string; detail?: string }) {
  return <div className="rounded-lg border border-border bg-card p-4"><div className="flex items-center justify-between text-sm text-muted-foreground"><span>{label}</span><span className="text-primary [&_svg]:size-4">{icon}</span></div><p className="mt-2 break-words text-2xl font-semibold">{value}</p>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>;
}

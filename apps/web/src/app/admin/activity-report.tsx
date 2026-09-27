"use client";
import { useState, type FormEvent } from "react";
import { inclusivePeriodUtc, type ActivityReportResponse } from "@cashback/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

async function read(response: Response): Promise<ActivityReportResponse> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body as ActivityReportResponse;
}

function metrics(row: ActivityReportResponse["activity"][number], kind: string) {
  return row.metrics.filter((metric) => metric.kind === kind)
    .map((metric) => `${metric.amount ?? metric.valueState} ${metric.asset}`).join(", ") || "—";
}

export function ActivityReport({ exchanges }: { exchanges: Array<{ id: string; name: string }> }) {
  const [report, setReport] = useState<ActivityReportResponse | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function fetchPage(base: string, cursor?: string) {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams(base);
      if (cursor) params.set("cursor", cursor);
      setReport(await fetch(`/api/admin/reports/activity?${params}`, { cache: "no-store" }).then(read));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load activity"); }
    finally { setBusy(false); }
  }
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const period = inclusivePeriodUtc(String(fields.get("start")), String(fields.get("end")), String(fields.get("sourceTz") ?? "").trim());
      const base = new URLSearchParams({ exchangeId: String(fields.get("exchangeId") ?? ""), ...period }).toString();
      setQuery(base);
      void fetchPage(base);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid report period"); }
  }
  return <section className="mt-8 space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={load} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Exchange<select name="exchangeId" className="mt-1 block w-full rounded-md border border-border bg-background p-2" required>{exchanges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm">Source timezone<Input name="sourceTz" required placeholder="UTC" /></label>
      <label className="text-sm">Period start<Input name="start" type="date" required /></label>
      <label className="text-sm">Period end<Input name="end" type="date" required /></label>
      <Button type="submit" disabled={busy}>Show activity</Button>
    </form>
    {report && <>
      <p className="text-sm text-muted-foreground">{report.note} Reported commission is not pending or settled cashback.</p>
      <p className="text-xs text-muted-foreground">API totals include whole UTC day buckets that overlap the selected period. A non-UTC boundary makes those rows partial because daily values cannot be prorated.</p>
      {!!report.coverageDays.length && <p className="text-sm">API coverage: {report.coverageDays.map((day) => `${day.rootAccount}: ${day.fetched}/${day.expected} days fetched, ${day.open} open, ${day.missing} missing`).join("; ")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border"><th className="py-2 pr-3">UID</th><th className="py-2 pr-3">Root</th><th className="py-2 pr-3">Referral code</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Source as of</th><th className="py-2 pr-3">Fetched at</th><th className="py-2 pr-3">Volume</th><th className="py-2 pr-3">Commission</th><th className="py-2 pr-3">Data</th><th className="py-2">Partial</th></tr></thead>
          <tbody>{report.activity.map((row) => <tr key={`${row.source}:${row.rootAccount}:${row.uid}`} className="border-b border-border/60"><td className="py-2 pr-3 font-mono">{row.uid}</td><td className="py-2 pr-3">{row.rootAccount}</td><td className="py-2 pr-3">{row.referralCode ?? "—"}</td><td className="py-2 pr-3">{row.source}</td><td className="py-2 pr-3 whitespace-nowrap">{row.sourceAsOf ? new Date(row.sourceAsOf).toLocaleString() : "—"}</td><td className="py-2 pr-3 whitespace-nowrap">{row.fetchedAt ? new Date(row.fetchedAt).toLocaleString() : "—"}</td><td className="py-2 pr-3">{metrics(row, "TRADE_VOLUME")}</td><td className="py-2 pr-3">{metrics(row, "REPORTED_COMMISSION")}</td><td className="py-2 pr-3">{row.dataState}</td><td className="py-2">{row.partial ? "Yes" : "No"}</td></tr>)}</tbody>
        </table>
      </div>
      {!report.activity.length && <p className="text-sm text-muted-foreground">No reported rows for this period.</p>}
      {report.nextCursor && <Button type="button" variant="outline" disabled={busy} onClick={() => void fetchPage(query, report.nextCursor ?? undefined)}>Next</Button>}
    </>}
  </section>;
}

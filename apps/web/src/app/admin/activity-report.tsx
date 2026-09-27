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

function dataStateLabel(state: ActivityReportResponse["activity"][number]["dataState"]) {
  switch (state) {
    case "REPORTED": return "Reported data";
    case "INCOMPLETE": return "Coverage incomplete";
    case "NO_ACTIVITY": return "No activity";
  }
}

export function ActivityReport({ exchanges, todayUtc }: { exchanges: Array<{ id: string; name: string }>; todayUtc: string }) {
  const [report, setReport] = useState<ActivityReportResponse | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pageCursors, setPageCursors] = useState<Array<string | null>>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  async function fetchPage(base: string, cursor?: string, onSuccess?: () => void) {
    setBusy(true); setError("");
    try {
      const params = new URLSearchParams(base);
      if (cursor) params.set("cursor", cursor);
      const nextReport = await fetch(`/api/admin/reports/activity?${params}`, { cache: "no-store" }).then(read);
      setReport(nextReport);
      onSuccess?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load activity"); }
    finally { setBusy(false); }
  }
  function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    try {
      const period = inclusivePeriodUtc(String(fields.get("start")), String(fields.get("end")), "UTC");
      const base = new URLSearchParams({ exchangeId: String(fields.get("exchangeId") ?? ""), ...period }).toString();
      void fetchPage(base, undefined, () => { setQuery(base); setPageCursors([null]); setPageIndex(0); });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Invalid report period"); }
  }
  function goToPage(index: number) {
    void fetchPage(query, pageCursors[index] ?? undefined, () => setPageIndex(index));
  }
  function nextPage() {
    const cursor = report?.nextCursor;
    if (!cursor) return;
    void fetchPage(query, cursor, () => {
      setPageCursors((current) => [...current.slice(0, pageIndex + 1), cursor]);
      setPageIndex(pageIndex + 1);
    });
  }
  return <section className="mt-8 space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={load} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="text-sm">Exchange<select name="exchangeId" className="mt-1 block w-full rounded-md border border-border bg-background p-2" required>{exchanges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="text-sm">Period start (UTC)<Input name="start" type="date" defaultValue={todayUtc} className="activity-date-input" required /></label>
      <label className="text-sm">Period end (UTC)<Input name="end" type="date" defaultValue={todayUtc} className="activity-date-input" required /></label>
      <Button type="submit" disabled={busy}>Show activity</Button>
    </form>
    {report && <>
      <p className="text-sm text-muted-foreground">{report.note}</p>
      <p className="text-xs text-muted-foreground">API totals include whole UTC day buckets in the selected period.</p>
      <p className="text-xs text-muted-foreground"><strong className="text-foreground">Reported data</strong>: the source supplied metrics, not pending or settled cashback. <strong className="text-foreground">Coverage incomplete</strong>: a day is unsealed or missing, so “—” is unknown, not zero. <strong className="text-foreground">No activity</strong>: all selected days are sealed with no metric for that UID. Partial means some data may still change or cover only part of the period.</p>
      {!!report.coverageDays.length && <p className="text-sm">API coverage: {report.coverageDays.map((day) => `${day.rootAccount}: ${day.fetched}/${day.expected} days fetched, ${day.open} unsealed, ${day.missing} missing`).join("; ")}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-border"><th className="py-2 pr-3">UID</th><th className="py-2 pr-3">Root</th><th className="py-2 pr-3">Referral code</th><th className="py-2 pr-3">Source</th><th className="py-2 pr-3">Source as of</th><th className="py-2 pr-3">Fetched at</th><th className="py-2 pr-3">Volume</th><th className="py-2 pr-3">Commission</th><th className="py-2 pr-3">Data</th><th className="py-2">Partial</th></tr></thead>
          <tbody>{report.activity.map((row) => <tr key={`${row.source}:${row.rootAccount}:${row.uid}`} className="border-b border-border/60"><td className="py-2 pr-3 font-mono">{row.uid}</td><td className="py-2 pr-3">{row.rootAccount}</td><td className="py-2 pr-3">{row.referralCode ?? "—"}</td><td className="py-2 pr-3">{row.source}</td><td className="py-2 pr-3 whitespace-nowrap">{row.sourceAsOf ? new Date(row.sourceAsOf).toLocaleString() : "—"}</td><td className="py-2 pr-3 whitespace-nowrap">{row.fetchedAt ? new Date(row.fetchedAt).toLocaleString() : "—"}</td><td className="py-2 pr-3">{metrics(row, "TRADE_VOLUME")}</td><td className="py-2 pr-3">{metrics(row, "REPORTED_COMMISSION")}</td><td className="py-2 pr-3">{dataStateLabel(row.dataState)}</td><td className="py-2">{row.partial ? "Yes" : "No"}</td></tr>)}</tbody>
        </table>
      </div>
      {!report.activity.length && <p className="text-sm text-muted-foreground">No reported rows for this period.</p>}
      {(pageIndex > 0 || report.nextCursor) && <nav aria-label="Report pages" className="flex flex-wrap items-center gap-2">
        {pageIndex > 0 && <><Button type="button" variant="outline" disabled={busy} onClick={() => goToPage(0)}>First</Button><Button type="button" variant="outline" disabled={busy} onClick={() => goToPage(pageIndex - 1)}>Previous</Button></>}
        <span className="text-sm text-muted-foreground">Page {pageIndex + 1}</span>
        {report.nextCursor && <Button type="button" variant="outline" disabled={busy} onClick={nextPage}>Next</Button>}
      </nav>}
    </>}
  </section>;
}

"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import type { ImportPreview } from "@cashback/contracts";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Batch = { id: string; status: string; rootAccount: string; periodStart: string; periodEnd: string };
async function json(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Request failed"); return body; }

export function BybitOperations({ exchangeId }: { exchangeId: string | null }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const processing = batches.some(batch => ["UPLOADED", "PARSING", "COMMITTING"].includes(batch.status));
  const refresh = useCallback(async () => {
    try {
      const reports = await fetch("/api/admin/imports", { cache: "no-store" }).then(json);
      setBatches(reports.batches);
      if (selected) setPreview(await fetch(`/api/admin/imports/${selected}`, { cache: "no-store" }).then(json));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load operations"); }
  }, [selected]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, processing ? 5000 : 30000); return () => clearInterval(timer); }, [processing, refresh]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    const payload = new FormData();
    const file = fields.get("file"); if (file) payload.set("file", file);
    const metadata = { exchangeId, rootAccount: fields.get("rootAccount"), reportType: fields.get("reportType"),
      periodStart: `${fields.get("periodStart")}T00:00:00.000Z`, periodEnd: `${fields.get("periodEnd")}T23:59:59.999Z`, sourceTz: "UTC",
      ...(fields.get("sourceAsOf") ? { sourceAsOf: `${fields.get("sourceAsOf")}:00.000Z` } : {}) };
    payload.set("metadata", JSON.stringify(metadata));
    try { const result = await fetch("/api/admin/imports", { method: "POST", body: payload }).then(json); setSelected(result.batchId); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!selected) return; setBusy(true); setError("");
    try { await fetch(`/api/admin/imports/${selected}/commit`, { method: "POST" }).then(json); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Publish failed"); } finally { setBusy(false); }
  }
  const batchColumns = useMemo<ColumnDef<Batch>[]>(() => [
    { accessorKey: "rootAccount", header: ({ column }) => <DataTableColumnHeader column={column} title="Root account" />, cell: ({ row }) => <Button type="button" variant="link" className="h-auto p-0" onClick={() => setSelected(row.original.id)}>{row.original.rootAccount}</Button> },
    { accessorKey: "status", filterFn: "equals", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" /> },
    { accessorKey: "periodStart", header: ({ column }) => <DataTableColumnHeader column={column} title="Period start" />, cell: ({ row }) => row.original.periodStart.slice(0, 10) },
    { accessorKey: "periodEnd", header: ({ column }) => <DataTableColumnHeader column={column} title="Period end" />, cell: ({ row }) => row.original.periodEnd.slice(0, 10) }
  ], []);
  return <section className="mt-10 space-y-6 rounded-xl border border-border bg-card p-6">
    <h2 className="text-2xl font-semibold">Bybit cashback operations</h2>
    <p className="text-sm text-muted-foreground">Upload normalized Bybit CSV v1: uid,asset,commission. Optional transaction_id,occurred_at,referral_link_id. Commission is affiliate earnings in the stated currency, not trading volume or customer fees. Review before publishing.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!exchangeId ? <p>Publish the Bybit exchange to enable imports.</p> : <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className="space-y-1 text-sm">Root affiliate account<Input name="rootAccount" required maxLength={200} /></label>
      <label className="space-y-1 text-sm">Period start (UTC)<Input name="periodStart" type="date" required /></label>
      <label className="space-y-1 text-sm">Period end (UTC)<Input name="periodEnd" type="date" required /></label>
      <label className="space-y-1 text-sm">Source as of (UTC, optional)<Input name="sourceAsOf" type="datetime-local" /></label>
      <label className="space-y-1 text-sm">Report type<select name="reportType" className="block w-full rounded-md border border-border bg-background p-2"><option value="AGGREGATE">Period totals per UID + currency</option><option value="TRANSACTION">Transactions (falls back to aggregate without ID)</option></select></label>
      <label className="space-y-1 text-sm">CSV file<Input name="file" type="file" accept=".csv,text/csv" required /></label>
      <Button type="submit" disabled={busy}>Upload for preview</Button>
    </form>}
    <div className="grid gap-5 lg:grid-cols-2"><div><h3 className="mb-3 font-semibold">Recent reports</h3><DataTable data={batches} columns={batchColumns} searchKey="rootAccount" searchPlaceholder="Filter reports..." filters={[{ columnId: "status", title: "Status", options: ["UPLOADED","PARSING","PREVIEW","COMMITTING","PUBLISHED","FAILED"].map(value => ({ value, label: value })) }]} empty="No import reports." /></div>
      <div>{preview ? <><h3 className="font-semibold">Preview: {preview.batch.status}</h3><p className="mt-2 text-sm">{preview.preview.totalRows} rows · {preview.preview.flaggedRows} flagged</p><pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs">{JSON.stringify({ totals: preview.batch.totals, flaggedRows: preview.preview.rows }, null, 2)}</pre><Button className="mt-3" disabled={busy || preview.batch.status !== "PREVIEW" || preview.preview.flaggedRows > 0} onClick={() => void publish()}>Publish verified report</Button><p className="mt-2 text-xs text-muted-foreground">Publishing applies the report to UID accounts. Corrections replace the same period/transaction; partial overlaps are rejected.</p></> : <p className="text-sm text-muted-foreground">Select a report to review its status and validation results.</p>}</div>
    </div>
  </section>;
}

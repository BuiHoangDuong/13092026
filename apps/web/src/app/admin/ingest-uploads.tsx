"use client";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { inclusivePeriodUtc, wallDateTimeToUtc, type ImportPreview } from "@cashback/contracts";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Adapter = { id: string; exchangeSlug: string; datasetKind: "REFERRAL_ACTIVITY" | "COMMISSION"; sourceMethod: string; accept: string[]; fields: string[]; affectsCashback: boolean; contractVersion: string };
type Exchange = { id: string; slug: string; name: string };
type Batch = { id: string; status: string; rootAccount: string; exchangeId: string; datasetKind: string; sourceMethod: string; affectsCashback: boolean; periodStart: string; periodEnd: string; createdAt: string };
const activeStatuses = new Set(["UPLOADED", "PARSING", "COMMITTING"]);
function filenameAsOf(name: string) {
  const match = /(\d{4}-\d{2}-\d{2})[ T_](\d{2})_(\d{2})_(\d{2})/.exec(name);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}` : "";
}

async function read(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

export function IngestUploads() {
  const router = useRouter();
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [exchangeId, setExchangeId] = useState("");
  const [adapterId, setAdapterId] = useState("");
  const [batches, setBatches] = useState<Batch[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursor, setCursor] = useState("");
  const [filters, setFilters] = useState({ exchangeId: "", datasetKind: "", sourceMethod: "", status: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [asOfHint, setAsOfHint] = useState("");
  const exchange = exchanges.find((item) => item.id === exchangeId);
  const choices = useMemo(() => adapters.filter((adapter) => adapter.exchangeSlug === exchange?.slug), [adapters, exchange]);
  const adapter = choices.find((item) => item.id === adapterId) ?? null;
  const processing = batches.some((batch) => activeStatuses.has(batch.status));
  const columns = useMemo<ColumnDef<Batch>[]>(() => [
    { accessorKey: "rootAccount", header: ({ column }) => <DataTableColumnHeader column={column} title="Root account" />, cell: ({ row }) => <Link className="underline" href={`/admin/ingest/uploads/${row.original.id}`}>{row.original.rootAccount}</Link> },
    { id: "exchange", accessorFn: (row) => exchanges.find((item) => item.id === row.exchangeId)?.name ?? row.exchangeId, header: "Exchange" },
    { accessorKey: "datasetKind", header: "Dataset" },
    { accessorKey: "sourceMethod", header: "Source" },
    { accessorKey: "status", filterFn: "equals", header: "Status" },
    { accessorKey: "affectsCashback", header: "Cashback", cell: ({ row }) => row.original.affectsCashback ? "Affects cashback" : "No wallet effect" },
    { accessorKey: "periodStart", header: "Period", cell: ({ row }) => `${row.original.periodStart.slice(0, 10)}–${row.original.periodEnd.slice(0, 10)}` },
    { accessorKey: "createdAt", header: "Created", cell: ({ row }) => new Date(row.original.createdAt).toLocaleString() }
  ], [exchanges]);
  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/ingest/adapters", { cache: "no-store" }).then(read),
      fetch("/api/admin/exchanges", { cache: "no-store" }).then(read)
    ]).then(([adapterBody, exchangeBody]) => {
      setAdapters(adapterBody.adapters);
      setExchanges(exchangeBody.exchanges);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load upload options"));
  }, []);
  const refreshBatches = useCallback(async () => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (cursor) params.set("cursor", cursor);
    const batchBody = await fetch(`/api/admin/ingest/batches?${params}`, { cache: "no-store" }).then(read);
    setBatches(batchBody.batches);
    setNextCursor(batchBody.nextCursor);
  }, [filters, cursor]);
  useEffect(() => { void refreshBatches().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load uploads"));
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshBatches().catch(() => undefined); }, processing ? 5000 : 30000);
    return () => clearInterval(timer);
  }, [refreshBatches, processing]);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!adapter || !exchange) return;
    setBusy(true); setError("");
    const fields = new FormData(event.currentTarget);
    const sourceTz = adapter.fields.includes("sourceTz") ? String(fields.get("sourceTz") ?? "").trim() : "UTC";
    const payload = new FormData();
    const file = fields.get("file");
    if (file) payload.set("file", file);
    try {
      const period = inclusivePeriodUtc(String(fields.get("periodStart")), String(fields.get("periodEnd")), sourceTz);
      const metadata: Record<string, string> = { exchangeId: exchange.id, rootAccount: String(fields.get("rootAccount") ?? ""), datasetKind: adapter.datasetKind, sourceMethod: adapter.sourceMethod, sourceTz, ...period };
      if (adapter.fields.includes("reportType")) metadata.reportType = String(fields.get("reportType") ?? "");
      if (adapter.fields.includes("sourceAsOf")) metadata.sourceAsOf = wallDateTimeToUtc(String(fields.get("sourceAsOf") ?? ""), sourceTz);
      payload.set("metadata", JSON.stringify(metadata));
       const result = await fetch("/api/admin/ingest/batches", { method: "POST", body: payload }).then(read);
       router.push(`/admin/ingest/uploads/${result.batchId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  return <section className="mt-8 space-y-6">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <form onSubmit={upload} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm">Exchange
        <select className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={exchangeId} onChange={(event) => { setExchangeId(event.target.value); setAdapterId(""); }} required>
          <option value="">Select</option>
           {exchanges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className="text-sm">Dataset
         <select className="mt-1 block w-full rounded-md border border-border bg-background p-2" value={adapterId} onChange={(event) => { setAdapterId(event.target.value); setAsOfHint(""); }} required disabled={!choices.length}>
           <option value="">Select</option>
           {choices.map((item) => <option key={`${item.id}:${item.contractVersion}`} value={item.id}>{item.datasetKind === "COMMISSION" ? "Commission" : "Referral activity"} · {item.sourceMethod} · {item.accept.join(", ")}</option>)}
        </select>
      </label>
      {adapter?.fields.includes("rootAccount") && <label className="text-sm">Root affiliate account<Input name="rootAccount" required maxLength={200} /></label>}
      {adapter?.fields.includes("sourceTz") && <label className="text-sm">Source timezone<Input name="sourceTz" required placeholder="Asia/Ho_Chi_Minh" /></label>}
      {adapter?.fields.includes("period") && <label className="text-sm">Period start<Input name="periodStart" type="date" required /></label>}
      {adapter?.fields.includes("period") && <label className="text-sm">Period end<Input name="periodEnd" type="date" required /></label>}
       {adapter?.fields.includes("sourceAsOf") && <label className="text-sm">Source as of<Input name="sourceAsOf" type="datetime-local" step={1} required defaultValue={asOfHint} key={asOfHint} /></label>}
      {adapter?.fields.includes("reportType") && <label className="text-sm">Report type<select name="reportType" className="mt-1 block w-full rounded-md border border-border bg-background p-2"><option value="AGGREGATE">Period totals</option><option value="TRANSACTION">Transactions</option></select></label>}
       {adapter && <label className="text-sm">File ({adapter.accept.join(", ")})<Input name="file" type="file" accept={adapter.accept.join(",")} required onChange={(event) => setAsOfHint(filenameAsOf(event.target.files?.[0]?.name ?? ""))} /></label>}
       {asOfHint && adapter?.fields.includes("sourceAsOf") && <p className="text-xs text-muted-foreground sm:col-span-2">Source as-of was prefilled from the file name. Confirm its timezone before upload.</p>}
      <p className="text-sm text-muted-foreground sm:col-span-2">{adapter ? (adapter.affectsCashback ? "This dataset can change cashback wallets after publish." : "This dataset does not change cashback wallets.") : "Choose an exchange and dataset. The file type is taken from the file."}</p>
      <Button type="submit" disabled={busy || !adapter}>Upload for preview</Button>
    </form>
     <form className="grid gap-3 border-t border-border pt-4 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); const fields = new FormData(event.currentTarget); setCursor(""); setFilters({ exchangeId: String(fields.get("exchangeId") ?? ""), datasetKind: String(fields.get("datasetKind") ?? ""), sourceMethod: String(fields.get("sourceMethod") ?? ""), status: String(fields.get("status") ?? "") }); }}>
      <select name="exchangeId" className="rounded-md border border-border bg-background p-2 text-sm"><option value="">All exchanges</option>{exchanges.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
       <select name="datasetKind" className="rounded-md border border-border bg-background p-2 text-sm"><option value="">All datasets</option>{[...new Set(adapters.map((item) => item.datasetKind))].map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
       <select name="sourceMethod" className="rounded-md border border-border bg-background p-2 text-sm"><option value="">All sources</option>{[...new Set(adapters.map((item) => item.sourceMethod))].map((method) => <option key={method} value={method}>{method}</option>)}</select>
      <select name="status" className="rounded-md border border-border bg-background p-2 text-sm"><option value="">All statuses</option>{["UPLOADED", "PARSING", "PREVIEW", "COMMITTING", "PUBLISHED", "FAILED"].map((status) => <option key={status}>{status}</option>)}</select>
      <Button type="submit" variant="outline">Filter</Button>
    </form>
    <DataTable data={batches} columns={columns} searchKey="rootAccount" searchPlaceholder="Filter loaded batches by root account" filters={[{ columnId: "status", title: "Status", options: ["UPLOADED", "PARSING", "PREVIEW", "COMMITTING", "PUBLISHED", "FAILED"].map((value) => ({ value, label: value })) }]} pageSize={30} empty="No batches." />
     {nextCursor && <Button type="button" variant="outline" onClick={() => setCursor(nextCursor)}>Next batch page</Button>}
  </section>;
}

export function BatchPreview({ id }: { id: string }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { setPreview(await fetch(`/api/admin/ingest/batches/${id}`, { cache: "no-store" }).then(read)); }, [id]);
  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the batch"));
    if (!preview || activeStatuses.has(preview.batch.status)) {
      const timer = setInterval(() => { if (document.visibilityState === "visible") void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load the batch")); }, 5000);
      return () => clearInterval(timer);
    }
  }, [load, preview?.batch.status]);
  async function publish() {
    setBusy(true); setError("");
    try { await fetch(`/api/admin/ingest/batches/${id}/commit`, { method: "POST" }).then(read); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Publish failed"); }
    finally { setBusy(false); }
  }
  async function retransform() {
    if (!preview?.rawLoad) return;
    setBusy(true); setError("");
    try { await fetch(`/api/admin/ingest/loads/${preview.rawLoad.id}/retransform`, { method: "POST" }).then(read); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to re-run transform"); }
    finally { setBusy(false); }
  }
  const warnings = preview?.batch.totals && typeof preview.batch.totals === "object" && Array.isArray((preview.batch.totals as { warnings?: unknown }).warnings) ? (preview.batch.totals as { warnings: string[] }).warnings : [];
  return <section className="mt-8 space-y-3">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {preview && <>
      <p className="text-sm">{preview.batch.status} · {preview.batch.datasetKind} · {preview.preview.totalRows} rows · {preview.preview.flaggedRows} flagged · {preview.batch.affectsCashback ? "Affects cashback" : "Does not affect cashback"}</p>
      {preview.rawLoad && <p className="text-sm">Raw load: {preview.rawLoad.state} · {preview.rawLoad.rowCount} rows · fields: {preview.rawLoad.fieldNames.join(", ")}{preview.rawLoad.safeErrorCode ? ` · ${preview.rawLoad.safeErrorCode}` : ""}</p>}
      {!!warnings.length && <ul className="list-disc pl-5 text-sm text-muted-foreground">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
      <pre className="max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{JSON.stringify({ totals: preview.batch.totals, flaggedRows: preview.preview.rows }, null, 2)}</pre>
       <Button type="button" disabled={busy || preview.batch.status !== "PREVIEW" || preview.preview.flaggedRows > 0} onClick={() => void publish()}>Publish</Button>
       {preview.rawLoad?.state === "FAILED" && <Button type="button" variant="outline" disabled={busy} onClick={() => void retransform()}>Re-run transform</Button>}
       {preview.batch.datasetKind === "COMMISSION" && <p className="text-xs text-muted-foreground">Corrections replace the same period or transaction; partial overlaps are rejected.</p>}
    </>}
  </section>;
}

"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { ImportPreview } from "@cashback/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Batch = { id: string; status: string; rootAccount: string; periodStart: string; periodEnd: string };
type Uid = { id: string; uid: string; customer: { email: string }; ownershipApprovedAt: string | null };
async function json(response: Response) { const body = await response.json(); if (!response.ok) throw new Error(body.error?.message ?? "Request failed"); return body; }

export function BybitOperations({ exchangeId }: { exchangeId: string | null }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [links, setLinks] = useState<Uid[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [reports, uids] = await Promise.all([fetch("/api/admin/imports", { cache: "no-store" }).then(json), fetch("/api/admin/uids", { cache: "no-store" }).then(json)]);
      setBatches(reports.batches); setLinks(uids.links);
      if (selected) setPreview(await fetch(`/api/admin/imports/${selected}`, { cache: "no-store" }).then(json));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load operations"); }
  }, [selected]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 5000); return () => clearInterval(timer); }, [refresh]);
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
  async function approve(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); setBusy(true); setError(""); const note = new FormData(event.currentTarget).get("note");
    try { await fetch(`/api/admin/uids/${id}/approve`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ note }) }).then(json); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Approval failed"); } finally { setBusy(false); }
  }
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
    <div className="grid gap-5 lg:grid-cols-2"><div><h3 className="mb-3 font-semibold">Recent reports</h3><ul className="max-h-80 space-y-2 overflow-y-auto">{batches.map(batch => <li key={batch.id}><button className="w-full rounded border border-border p-3 text-left text-sm hover:bg-muted" onClick={() => setSelected(batch.id)}>{batch.rootAccount} · {batch.status}<span className="block text-xs text-muted-foreground">{batch.periodStart.slice(0, 10)} — {batch.periodEnd.slice(0, 10)}</span></button></li>)}</ul></div>
      <div>{preview ? <><h3 className="font-semibold">Preview: {preview.batch.status}</h3><p className="mt-2 text-sm">{preview.preview.totalRows} rows · {preview.preview.flaggedRows} flagged</p><pre className="mt-3 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-xs">{JSON.stringify({ totals: preview.batch.totals, flaggedRows: preview.preview.rows }, null, 2)}</pre><Button className="mt-3" disabled={busy || preview.batch.status !== "PREVIEW" || preview.preview.flaggedRows > 0} onClick={() => void publish()}>Publish verified report</Button><p className="mt-2 text-xs text-muted-foreground">Publishing applies the report to verified UID owners. Corrections replace the same period/transaction; partial overlaps are rejected.</p></> : <p className="text-sm text-muted-foreground">Select a report to review its status and validation results.</p>}</div>
    </div>
    <div className="border-t border-border pt-5"><h3 className="font-semibold">UID ownership review</h3><p className="mt-2 text-sm text-muted-foreground">Confirm the claimant controls the Bybit account before approving. Report membership alone does not prove ownership.</p><div className="mt-4 space-y-3">{links.map(link => <form key={link.id} onSubmit={event => void approve(event, link.id)} className="rounded border border-border p-4"><p className="mb-3 text-sm">{link.customer.email} · UID {link.uid}</p>{link.ownershipApprovedAt ? <p className="text-xs text-muted-foreground">Ownership approved; waiting for a published report.</p> : <div className="flex flex-wrap gap-2"><Input name="note" aria-label={`Ownership evidence for UID ${link.uid}`} placeholder="Ownership evidence / support ticket reference" minLength={10} maxLength={1000} required className="min-w-48 flex-1" /><Button disabled={busy} type="submit">Confirm ownership</Button></div>}</form>)}{!links.length && <p className="text-sm text-muted-foreground">No pending UID claims.</p>}</div></div>
  </section>;
}

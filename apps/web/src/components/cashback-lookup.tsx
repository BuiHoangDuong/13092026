"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { getMessages, type Locale } from "../i18n";
function money(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
function rateLabel(value: string | null, unknown: string) {
  if (value == null) return unknown;
  const percent = Number(value) * 100;
  if (!Number.isFinite(percent)) return unknown;
  return `${percent.toFixed(2).replace(/\.00$/, "")}%`;
}
export function CashbackLookup({ exchanges, locale }: { exchanges: Array<{ id: string; name: string }>; locale: Locale }) {
  const m = getMessages(locale).lookup;
  const a = getMessages(locale).aurora;
  const [result, setResult] = useState<LookupResponse | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ exchangeId: string; uid: string } | null>(null);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  function clearResult() { generation.current++; request.current?.abort(); setBusy(false); setResult(null); setError(""); setSelection(null); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitted = { exchangeId: String(data.get("exchangeId") ?? ""), uid: String(data.get("uid") ?? "").trim() };
    if (!submitted.uid || !submitted.exchangeId) { setError(m.help); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++generation.current;
    setBusy(true); setError(""); setResult(null); setSelection(null);
    let visibleError = m.unavailable;
    try {
      const response = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submitted), cache: "no-store", signal: controller.signal });
      if (response.status === 429) {
        const retryAfter = response.headers.get("retry-after") ?? "60";
        visibleError = m.rateLimited.replace("{{seconds}}", /^\d{1,6}$/.test(retryAfter) ? retryAfter : "60");
        throw new Error(visibleError);
      }
      if (!response.ok) throw new Error(m.unavailable);
      const body = await response.json();
      if (current !== generation.current) return;
      setResult(lookupResponseSchema.parse(body));
      setSelection(submitted);
    } catch { if (current === generation.current) setError(visibleError); } finally { if (current === generation.current) setBusy(false); }
  }
  return <section id="lookup" aria-labelledby="cashback-lookup-title" className="aurora-section">
    <div className="aurora-lookup-panel"><div><p className="aurora-eyebrow">{a.lookupEyebrow}</p><h2 id="cashback-lookup-title">{a.lookupTitle}</h2><p>{a.lookupLead}</p><p className="aurora-email-note">{a.emailNote}</p></div>
    <form onSubmit={submit} className="aurora-lookup-form">
      <label>{m.exchange}<select name="exchangeId" required disabled={busy || !exchanges.length} onChange={clearResult} defaultValue={exchanges.find(x => x.name.toLowerCase() === "bybit")?.id ?? ""}><option value="" disabled>{m.choose}</option>{exchanges.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>{m.uid}<Input name="uid" disabled={busy || !exchanges.length} required maxLength={128} autoComplete="off" placeholder={m.uidPlaceholder} onChange={clearResult} /></label>
      <button className="aurora-btn primary full" disabled={busy || !exchanges.length}>{busy ? m.loading : m.check}</button>
      <p className="aurora-form-help">{m.help}</p>
      {!exchanges.length && <p role="status">{m.unavailable}</p>}
    </form></div>
    <div aria-live="polite" aria-busy={busy}>{error && <p role="alert" className="aurora-error mt-4">{error}</p>}{result && <div className="aurora-lookup-results mt-6 space-y-4">{!result.hasData ? <p>{m.noData}</p> : <><div className="grid gap-4 sm:grid-cols-2">{result.balances.map(w => <div key={w.asset} className="rounded-xl bg-muted p-5"><p className="font-semibold">{w.asset}</p><p className="mt-2 text-sm">{m.received}</p><p className="break-all text-3xl font-bold text-primary">{money(w.available)}</p><p className="mt-1 text-xs text-muted-foreground">{m.available}</p><p className="mt-3 break-all text-sm">{m.pending}: {money(w.pending)}</p></div>)}</div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <p className="px-4 pt-4 text-sm font-semibold">{m.txTitle}</p>
        <p className="px-4 pt-1 text-xs text-muted-foreground">{m.txLead}</p>
        {result.transactions.length ? <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-y border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2 font-medium">{m.txPeriod}</th><th className="px-4 py-2 font-medium">{m.txAsset}</th><th className="px-4 py-2 font-medium">{m.txPaid}</th><th className="px-4 py-2 font-medium">{m.txRate}</th><th className="px-4 py-2 font-medium">{m.txShare}</th></tr></thead><tbody>{result.transactions.map(row => <tr key={row.id} className="border-b border-border/60 last:border-0"><td className="px-4 py-2.5 text-muted-foreground">{row.periodStart.slice(0, 10)} – {row.periodEnd.slice(0, 10)}</td><td className="px-4 py-2.5">{row.asset}</td><td className="px-4 py-2.5">{money(row.commission)} {row.asset}</td><td className="px-4 py-2.5">{rateLabel(row.cashbackRate, m.unknown)}</td><td className="px-4 py-2.5 font-medium text-primary">{money(row.cashback)} {row.asset}</td></tr>)}</tbody></table> : <p className="px-4 py-4 text-sm text-muted-foreground">{m.txEmpty}</p>}
        {result.hasMore && <p className="px-4 py-3 text-xs text-muted-foreground">{m.txHasMore}</p>}
      </div>
      <Button asChild><Link href={`/withdraw?exchangeId=${encodeURIComponent(selection?.exchangeId ?? "")}&uid=${encodeURIComponent(selection?.uid ?? "")}`}>{m.withdraw}</Link></Button><p className="text-xs text-muted-foreground">{m.lastImport}: {result.lastImportAt ? new Date(result.lastImportAt).toISOString() : m.unknown}<br/>{m.sourceAsOf}: {result.sourceAsOf ?? m.unknown}</p></>}</div>}</div>
  </section>;
}

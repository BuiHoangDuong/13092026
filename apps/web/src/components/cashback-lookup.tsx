"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { Input } from "./ui/input";
import { getMessages, type Locale } from "../i18n";
function money(value: string) {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}
export function CashbackLookup({ exchanges, locale }: { exchanges: Array<{ id: string; name: string }>; locale: Locale }) {
  const m = getMessages(locale).lookup;
  const a = getMessages(locale).aurora;
  const [result, setResult] = useState<LookupResponse | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; request.current?.abort(); }, []);
  function clearResult() { generation.current++; request.current?.abort(); setBusy(false); setResult(null); setError(""); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const submitted = { exchangeId: String(data.get("exchangeId") ?? ""), uid: String(data.get("uid") ?? "").trim() };
    if (!submitted.uid || !submitted.exchangeId) { setError(m.help); return; }
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    const current = ++generation.current;
    setBusy(true); setError(""); setResult(null);
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
    } catch { if (current === generation.current) setError(visibleError); } finally { if (current === generation.current) setBusy(false); }
  }
  return <section id="lookup" aria-labelledby="cashback-lookup-title" className="aurora-section">
    <div className="aurora-lookup-panel"><div><p className="aurora-eyebrow">{a.lookupEyebrow}</p><h2 id="cashback-lookup-title">{a.lookupTitle}</h2><p>{a.lookupLead}</p><p className="aurora-email-note">{a.paymentNote}</p></div>
    <form onSubmit={submit} className="aurora-lookup-form">
      <label>{m.exchange}<select name="exchangeId" required disabled={busy || !exchanges.length} onChange={clearResult} defaultValue={exchanges.find(x => x.name.toLowerCase() === "bybit")?.id ?? ""}><option value="" disabled>{m.choose}</option>{exchanges.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label>{m.uid}<Input name="uid" disabled={busy || !exchanges.length} required maxLength={128} autoComplete="off" placeholder={m.uidPlaceholder} onChange={clearResult} /></label>
      <button className="aurora-btn primary full" disabled={busy || !exchanges.length}>{busy ? m.loading : m.check}</button>
      <p className="aurora-form-help">{m.help}</p>
      {!exchanges.length && <p role="status">{m.unavailable}</p>}
    </form></div>
    <div aria-live="polite" aria-busy={busy}>{error && <p role="alert" className="aurora-error mt-4">{error}</p>}{result && <div className="aurora-lookup-results mt-6 space-y-4">{!result.hasData ? <p>{m.noData}</p> : <><div className="grid gap-4">{result.balances.map(w => <div key={w.asset} className="rounded-xl bg-muted p-5">
      <p className="font-semibold">{w.asset}</p><div className="mt-3 grid gap-4 sm:grid-cols-3">
        <div><p className="text-sm">{m.totalPaid}</p><p className="break-all text-3xl font-bold text-primary">{money(w.totalPaid)}</p><p className="mt-1 text-xs text-muted-foreground">{m.paidNote}</p></div>
        {([{ label: m.previousDay, value: w.previousDay }, { label: m.rolling30Days, value: w.rolling30Days }] as const).map(metric => <div key={metric.label}><p className="text-sm">{metric.label}</p><p className="mt-1 break-all text-xl font-semibold">{metric.value.status === "REPORTED" ? money(metric.value.amount) : "—"}</p>{metric.value.status !== "REPORTED" && <p className="mt-1 text-xs text-muted-foreground">{metric.value.status === "INSUFFICIENT_DETAIL" ? m.insufficientDetail : m.noPeriodData}</p>}</div>)}
      </div>{result.summaryPeriods.reportDay && <p className="mt-4 text-xs text-muted-foreground">{m.reportedPeriod}: {result.summaryPeriods.reportDay} · {m.rollingPeriod}: {result.summaryPeriods.rollingStart?.slice(0, 10)} – {result.summaryPeriods.reportDay} (UTC)</p>}
    </div>)}</div>
      <div className="overflow-x-auto rounded-xl border border-border">
        <p className="px-4 pt-4 text-sm font-semibold">{m.txTitle}</p>
        <p className="px-4 pt-1 text-xs text-muted-foreground">{m.txLead}</p>
        {result.transactions.length ? <table className="mt-3 w-full text-left text-sm"><thead><tr className="border-y border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2 font-medium">{m.txPeriod}</th><th className="px-4 py-2 font-medium">{m.txAsset}</th><th className="px-4 py-2 font-medium">{m.uid}</th><th className="px-4 py-2 font-medium">{m.txShare}</th></tr></thead><tbody>{result.transactions.map(row => <tr key={row.id} className="border-b border-border/60 last:border-0"><td className="px-4 py-2.5 text-muted-foreground">{row.periodStart.slice(0, 10)} – {row.periodEnd.slice(0, 10)}</td><td className="px-4 py-2.5">{row.asset}</td><td className="px-4 py-2.5">{row.uid}</td><td className="px-4 py-2.5 font-medium text-primary">{money(row.cashback)} {row.asset}</td></tr>)}</tbody></table> : <p className="px-4 py-4 text-sm text-muted-foreground">{m.txEmpty}</p>}
        {result.hasMore && <p className="px-4 py-3 text-xs text-muted-foreground">{m.txHasMore}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{m.lastImport}: {result.lastImportAt ? new Date(result.lastImportAt).toISOString() : m.unknown}<br/>{m.sourceAsOf}: {result.sourceAsOf ?? m.unknown}</p></>}</div>}</div>
  </section>;
}

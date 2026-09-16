"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { lookupResponseSchema, type LookupResponse } from "@cashback/contracts";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { getMessages, type Locale } from "../i18n";
export function CashbackLookup({ exchanges, locale }: { exchanges: Array<{ id: string; name: string }>; locale: Locale }) {
  const m = getMessages(locale).lookup;
  const [result, setResult] = useState<LookupResponse | null>(null); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<{ exchangeId: string; uid: string } | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setResult(null);
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/lookup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchangeId: data.get("exchangeId"), uid: data.get("uid") }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(response.status === 429 ? m.rateLimited.replace("{{seconds}}", response.headers.get("retry-after") ?? "60") : m.unavailable);
      setResult(lookupResponseSchema.parse(body));
      setSelection({ exchangeId: String(data.get("exchangeId")), uid: String(data.get("uid")).trim() });
    } catch (e) { setError(e instanceof Error ? e.message : m.unavailable); } finally { setBusy(false); }
  }
  return <section aria-labelledby="cashback-lookup-title" className="mb-10 rounded-2xl border border-primary/40 bg-card p-6 sm:p-8">
    <h2 id="cashback-lookup-title" className="text-3xl font-bold">{m.title}</h2><p className="mt-2 text-muted-foreground">{m.lead}</p>
    <form onSubmit={submit} className="mt-6 grid items-end gap-4 sm:grid-cols-[1fr_2fr_auto]">
      <label className="text-sm">{m.exchange}<select name="exchangeId" required disabled={busy} onChange={() => setResult(null)} defaultValue={exchanges.find(x => x.name.toLowerCase() === "bybit")?.id ?? ""} className="mt-2 block h-10 w-full rounded-md border border-border bg-background px-3"><option value="" disabled>{m.choose}</option>{exchanges.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="text-sm">{m.uid}<Input name="uid" disabled={busy} required maxLength={128} autoComplete="off" className="mt-2" placeholder={m.uidPlaceholder} onChange={() => setResult(null)} /></label>
      <Button disabled={busy || !exchanges.length}>{busy ? m.loading : m.check}</Button>
    </form><p className="mt-3 text-xs text-muted-foreground">{m.help}</p>
    <div aria-live="polite">{error && <p role="alert" className="mt-4 text-destructive">{error}</p>}{result && <div className="mt-6 space-y-4">{!result.hasData ? <p>{m.noData}</p> : <><div className="grid gap-4 sm:grid-cols-2">{result.balances.map(w => <div key={w.asset} className="rounded-xl bg-muted p-5"><p className="font-semibold">{w.asset}</p><p className="mt-2 text-sm">{m.available}</p><p className="break-all text-3xl font-bold text-primary">{w.available}</p><p className="mt-3 break-all text-sm">{m.pending}: {w.pending}</p></div>)}</div><Button asChild><Link href={`/withdraw?exchangeId=${encodeURIComponent(selection?.exchangeId ?? "")}&uid=${encodeURIComponent(selection?.uid ?? "")}`}>{m.withdraw}</Link></Button><p className="text-xs text-muted-foreground">{m.lastImport}: {result.lastImportAt ? new Date(result.lastImportAt).toISOString() : m.unknown}<br/>{m.sourceAsOf}: {result.sourceAsOf ?? m.unknown}</p></>}</div>}</div>
  </section>;
}

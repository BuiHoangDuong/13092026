"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UidLinksResponse, WalletResponse } from "@cashback/contracts";
import type { Messages } from "../i18n";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

type Props = { wallet: WalletResponse; links: UidLinksResponse; exchangeId: string | null; email: string; messages: Messages["cashback"]; detailed?: boolean };
const displayAmount = (value: string) => value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
const displayDate = (value: string) => new Date(value).toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
async function readResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message ?? "Request failed");
  return data;
}

export function CashbackDashboard({ wallet: initialWallet, links: initialLinks, exchangeId, email, messages: m, detailed = false }: Props) {
  const router = useRouter();
  const [wallet, setWallet] = useState(initialWallet);
  const [links, setLinks] = useState(initialLinks.links);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uid, setUid] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const refresh = useCallback(async () => {
    try {
      const [nextWallet, nextLinks] = await Promise.all([
        fetch("/api/me/wallet", { cache: "no-store" }).then(readResponse),
        fetch("/api/me/uids", { cache: "no-store" }).then(readResponse)
      ]);
      setWallet(current => historyExpanded ? { ...nextWallet, history: current.history, nextCursor: current.nextCursor } : nextWallet);
      setLinks(nextLinks.links); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : m.unavailable); }
  }, [m.unavailable, historyExpanded]);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30_000);
    return () => clearInterval(timer);
  }, [refresh]);
  async function linkUid(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      await fetch("/api/me/uids", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ exchangeId, uid }) }).then(readResponse);
      setUid(""); setNotice(m.linkAdded); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : m.unavailable); }
    finally { setBusy(false); }
  }
  async function more() {
    if (!wallet.nextCursor) return;
    setBusy(true);
    try {
      const page: WalletResponse = await fetch(`/api/me/wallet?cursor=${encodeURIComponent(wallet.nextCursor)}`, { cache: "no-store" }).then(readResponse);
      setHistoryExpanded(true);
      setWallet(current => ({ ...current, history: [...current.history, ...page.history], nextCursor: page.nextCursor }));
    } catch (e) { setError(e instanceof Error ? e.message : m.unavailable); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try { await fetch("/api/auth/logout", { method: "POST" }).then(readResponse); router.replace("/"); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : m.unavailable); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-6">
      <p className="break-all text-xs text-muted-foreground">{m.signedInAs} {email}</p>
      {error && <p role="alert" className="rounded-lg border border-destructive p-3 text-sm">{error}</p>}
      {notice && <p role="status" className="text-sm text-success">{notice}</p>}
      {!links.length && <p className="text-muted-foreground">{m.noUid}</p>}
      {links.length > 0 && !wallet.hasData && <p className="rounded-lg bg-muted p-4 text-muted-foreground">{m.noData}</p>}
      {wallet.hasData && wallet.balances.map(balance => (
        <div key={balance.asset} className="rounded-xl border border-border bg-background/60 p-5">
          <p className="text-sm text-muted-foreground">{m.available}</p>
          <p className="mt-1 break-words text-3xl font-bold text-primary sm:text-4xl">{displayAmount(balance.available)} <span className="text-lg">{balance.asset}</span></p>
          <dl className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {(["pending", "reserved", "withdrawn", "receivable"] as const).map(key => (
              <div key={key}><dt className="text-xs text-muted-foreground">{m[key]}</dt><dd className="mt-1 break-words font-medium">{displayAmount(balance[key])} {balance.asset}</dd></div>
            ))}
          </dl>
        </div>
      ))}
      <div className="grid gap-5 md:grid-cols-2">
        {exchangeId && <form onSubmit={linkUid} className="space-y-3">
          <label className="text-sm font-medium" htmlFor="cashback-uid">{m.uidLabel}</label>
          <div className="flex gap-2"><Input id="cashback-uid" inputMode="numeric" pattern="[0-9]+" maxLength={128} value={uid} onChange={e => setUid(e.target.value)} required placeholder="e.g. 123456789" /><Button disabled={busy} type="submit">{busy ? m.linking : m.linkUid}</Button></div>
          <p className="text-xs text-muted-foreground">{m.uidHelp}</p>
        </form>}
        <ul className="space-y-2 text-sm">
          {links.map(link => <li key={link.id} className="rounded-lg border border-border p-3"><span className="font-medium">{link.exchangeName} · {link.uid}</span><span className="mt-1 block text-muted-foreground">{link.status === "VERIFIED" ? m.verified : link.status === "REJECTED" ? m.rejected : link.ownershipApproved ? m.pendingReport : m.pendingOwnership}</span></li>)}
        </ul>
      </div>
      <p className="text-xs text-muted-foreground">{m.holdNote}</p>
      {wallet.hasData && <div className="space-y-1 text-xs text-muted-foreground"><p>{m.lastImport}: {wallet.lastImportAt ? displayDate(wallet.lastImportAt) : m.unknown}</p><p>{m.sourceAsOf}: {wallet.sourceAsOf ? displayDate(wallet.sourceAsOf) : m.unknown}</p></div>}
      <div className="flex flex-wrap gap-3"><Button variant="secondary" disabled={busy} onClick={() => void refresh()}>{m.refresh}</Button>{!detailed && <Button asChild><Link href="/me/wallet">{m.wallet}</Link></Button>}<Button variant="ghost" disabled={busy} onClick={() => void signOut()}>{m.signOut}</Button></div>
      {detailed && <section className="border-t border-border pt-6">
        <h2 className="text-xl font-semibold">{m.history}</h2>
        {!wallet.history.length ? <p className="mt-4 text-muted-foreground">{m.emptyHistory}</p> : <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{m.date}</th><th className="p-2">{m.movement}</th><th className="p-2">{m.amount}</th></tr></thead><tbody>{wallet.history.map(entry => <tr key={entry.id} className="border-t border-border"><td className="p-2 whitespace-nowrap">{displayDate(entry.createdAt)}</td><td className="p-2">{m.labels[entry.type as keyof typeof m.labels] ?? entry.type}</td><td className="p-2 whitespace-nowrap">{displayAmount(entry.amount)} {entry.asset}</td></tr>)}</tbody></table></div>}
        {wallet.nextCursor && <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => void more()}>{m.more}</Button>}
      </section>}
    </div>
  );
}

"use client";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { walletResponseSchema, withdrawalsResponseSchema, type WalletResponse, type WithdrawalsResponse, type PayoutRoutes } from "@cashback/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultLocale, getMessages } from "@/i18n";
type Principal = { exchangeId: string; uid: string; email: string };
export function WithdrawalFlow({ exchanges, routes, initial, exchangeId: seedExchange, uid: seedUid }: { exchanges: Array<{ id: string; name: string }>; routes: PayoutRoutes; initial: Principal | null; exchangeId: string; uid: string }) {
  const router = useRouter();
  const m = getMessages(defaultLocale).withdrawal; const cash = getMessages(defaultLocale).cashback;
  const [authenticated, setAuthenticated] = useState(Boolean(initial)); const [exchangeId,setExchangeId] = useState(initial?.exchangeId ?? seedExchange); const [uid,setUid] = useState(initial?.uid ?? seedUid);
  const [email,setEmail] = useState(initial?.email ?? ""); const [otp,setOtp] = useState<{ otpId: string; expiresAt: string } | null>(null); const [code,setCode] = useState("");
  const [wallet,setWallet] = useState<WalletResponse | null>(null); const [withdrawals,setWithdrawals] = useState<WithdrawalsResponse | null>(null);
  const [asset,setAsset] = useState(Object.keys(routes)[0] ?? ""); const [busy,setBusy] = useState(false); const [error,setError] = useState("");
  const generation = useRef(0);
  async function json(response: Response) { const body = await response.json(); if(response.status===401){setAuthenticated(false);setWallet(null);setWithdrawals(null);} if(!response.ok)throw new Error(body.error?.message ?? m.unavailable);return body; }
  const refresh = useCallback(async () => {
    const current = generation.current;
    try {
      const responses = await Promise.all([fetch("/api/uid/wallet",{cache:"no-store"}),fetch("/api/uid/withdrawals",{cache:"no-store"})]);
      if (current !== generation.current) return;
      if(responses.some(x=>x.status===401)){setAuthenticated(false);setWallet(null);setWithdrawals(null);return;}
      if(responses.some(x=>!x.ok))throw new Error(m.unavailable);
      const [w,d] = await Promise.all(responses.map(x=>x.json()));if(current !== generation.current)return;setWallet(walletResponseSchema.parse(w));setWithdrawals(withdrawalsResponseSchema.parse(d));
    } catch(e){setError(e instanceof Error?e.message:m.unavailable);}
  },[m.unavailable]);
  useEffect(()=>{if(!authenticated)return;void refresh();const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},30000);return()=>clearInterval(timer);},[authenticated,refresh]);
  async function action(work:()=>Promise<void>){setBusy(true);setError("");try{await work();}catch(e){setError(e instanceof Error?e.message:m.unavailable);}finally{setBusy(false);}}
  const post=(url:string,body:unknown={})=>fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}).then(json);
  function send(event:FormEvent){event.preventDefault();void action(async()=>{setOtp(await post("/api/otp/request",{exchangeId,uid,email}));setCode("");});}
  function verify(event:FormEvent){event.preventDefault();void action(async()=>{await post("/api/otp/verify",{otpId:otp?.otpId,code});generation.current++;setCode("");setOtp(null);setAuthenticated(true);router.refresh();});}
  function request(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);void action(async()=>{await post("/api/uid/withdrawals",{asset,amount:data.get("amount"),network:data.get("network"),address:data.get("address")});await refresh();});}
  async function older(kind:"wallet"|"withdrawals") { await action(async()=>{
    const cursor=kind==="wallet"?wallet?.nextCursor:withdrawals?.nextCursor;if(!cursor)return;
    const body=await fetch(`/api/uid/${kind}?cursor=${encodeURIComponent(cursor)}`,{cache:"no-store"}).then(json);
    if(kind==="wallet"){const page=walletResponseSchema.parse(body);setWallet(prev=>prev?{...page,history:[...prev.history,...page.history]}:page);}
    else{const page=withdrawalsResponseSchema.parse(body);setWithdrawals(prev=>prev?{...page,withdrawals:[...prev.withdrawals,...page.withdrawals]}:page);}
  }); }
  return <div className="space-y-8"><h1 className="text-3xl font-bold">{m.title}</h1><p className="text-muted-foreground">{m.firstReview}</p>
    {error&&<p role="alert" className="rounded-lg border border-destructive p-4 text-destructive">{error}</p>}
    {!authenticated ? <section className="max-w-lg rounded-xl border border-border bg-card p-6"><h2 className="text-xl font-semibold">{m.verifyEmail}</h2>{!otp?<form onSubmit={send} className="mt-5 space-y-4">
      <label className="block text-sm">{m.exchange}<select required disabled={busy} value={exchangeId} onChange={e=>setExchangeId(e.target.value)} className="mt-2 w-full rounded border border-border bg-background p-2"><option value="">{m.choose}</option>{exchanges.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="block text-sm">{m.uid}<Input required disabled={busy} maxLength={128} value={uid} onChange={e=>setUid(e.target.value)} /></label>
      <label className="block text-sm">{m.email}<Input required disabled={busy} type="email" value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email"/></label><p className="text-xs text-muted-foreground">{m.bindingNote}</p><Button disabled={busy}>{m.sendCode}</Button>
    </form>:<form onSubmit={verify} className="mt-5 space-y-4"><label className="block text-sm">{m.code}<Input required disabled={busy} inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value)} autoComplete="one-time-code"/></label><p className="text-xs text-muted-foreground">{m.expires}: {otp.expiresAt}</p><Button disabled={busy}>{m.verify}</Button><Button disabled={busy} type="button" variant="secondary" onClick={()=>{setOtp(null);setCode("");}}>{m.resend}</Button></form>}</section>:<>
      <div className="flex flex-wrap items-center justify-between gap-4"><p>{m.uid}: {uid} · {email}</p><Button variant="secondary" disabled={busy} onClick={()=>void action(async()=>{generation.current++;await post("/api/uid/logout");setAuthenticated(false);setWallet(null);setWithdrawals(null);router.refresh();})}>{m.signOut}</Button></div>
      {wallet && !wallet.hasData && <p>{cash.noData}</p>}
      {wallet && <p className="text-xs text-muted-foreground">{cash.lastImport}: {wallet.lastImportAt ?? cash.unknown}<br/>{cash.sourceAsOf}: {wallet.sourceAsOf ?? cash.unknown}</p>}
      <div className="grid gap-4 sm:grid-cols-2">{wallet?.balances.map(w=><section key={w.asset} className="rounded-xl border border-border bg-card p-5"><h2 className="font-bold">{w.asset}</h2><p className="mt-2 text-sm">{cash.available}</p><p className="break-all text-3xl font-bold text-primary">{w.available}</p>{(["pending","reserved","withdrawn","receivable"] as const).map(key=><p key={key} className="mt-2 break-all text-sm">{cash[key]}: {w[key]}</p>)}</section>)}</div>
      {!Object.keys(routes).length?<p>{m.unavailable}</p>:<form onSubmit={request} className="grid gap-4 rounded-xl border border-border bg-card p-6 sm:grid-cols-2"><h2 className="text-xl font-semibold sm:col-span-2">{m.request}</h2><label>{m.asset}<select value={asset} onChange={e=>setAsset(e.target.value)} className="mt-2 block w-full rounded border border-border bg-background p-2" disabled={busy}>{Object.keys(routes).map(a=><option key={a}>{a}</option>)}</select></label><label>{m.amount}<Input name="amount" required disabled={busy} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,10})?"/></label><label>{m.network}<select key={asset} name="network" className="mt-2 block w-full rounded border border-border bg-background p-2" required disabled={busy}>{routes[asset]?.map(n=><option key={n}>{n}</option>)}</select></label><label>{m.address}<Input name="address" required disabled={busy} maxLength={256}/></label><p className="text-xs text-muted-foreground sm:col-span-2">{m.availableOnly}</p><Button disabled={busy || !wallet || wallet.balances.some(w=>!/^0(?:\.0+)?$/.test(w.receivable))}>{m.request}</Button></form>}
      <section><h2 className="mb-4 text-xl font-semibold">{m.history}</h2><div className="space-y-3">{withdrawals?.withdrawals.map(w=><article key={w.id} className="rounded-lg border border-border p-4 text-sm"><p className="font-semibold">{w.amount} {w.asset} · {m.statuses[w.status]}</p><p className="mt-2 break-all">{w.network} · {w.address}</p><p className="mt-1 text-muted-foreground">{w.createdAt}{w.payoutRef&&` · ${w.payoutRef}`}</p>{["REQUESTED","UNDER_REVIEW","APPROVED","AUTO_APPROVED"].includes(w.status)&&<Button className="mt-3" variant="secondary" disabled={busy} onClick={()=>void action(async()=>{await post(`/api/uid/withdrawals/${w.id}/cancel`);await refresh();})}>{m.cancel}</Button>}</article>)}</div>{withdrawals?.nextCursor&&<Button className="mt-4" variant="secondary" disabled={busy} onClick={()=>void older("withdrawals")}>{m.more}</Button>}</section>
      <section><h2 className="mb-4 text-xl font-semibold">{cash.history}</h2><div className="overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">{cash.date}</th><th className="p-2">{cash.movement}</th><th className="p-2">{cash.amount}</th></tr></thead><tbody>{wallet?.history.map(e=><tr key={e.id} className="border-t border-border"><td className="p-2">{e.createdAt}</td><td className="p-2">{cash.labels[e.type]}</td><td className="p-2">{e.amount} {e.asset}</td></tr>)}</tbody></table></div>{wallet?.nextCursor&&<Button className="mt-4" variant="secondary" disabled={busy} onClick={()=>void older("wallet")}>{m.more}</Button>}</section>
    </>}
  </div>;
}

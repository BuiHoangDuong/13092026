"use client";
import { useState } from "react";
import Link from "next/link";
import { SyncControls } from "./sync-controls";

type ExchangeOption = { id: string; slug: string; name: string; apiSupported: boolean };

export function ConnectorSettings({ exchanges }: { exchanges: ExchangeOption[] }) {
  const [exchangeId, setExchangeId] = useState(exchanges.find(exchange => exchange.apiSupported)?.id ?? exchanges[0]?.id ?? "");
  const selected = exchanges.find(exchange => exchange.id === exchangeId);
  return <div className="mt-8 space-y-4">
    <label className="block max-w-md text-sm">Exchange
      <select value={exchangeId} onChange={event => setExchangeId(event.target.value)} className="mt-2 block h-10 w-full rounded-md border border-border bg-background px-3" disabled={!exchanges.length}>
        {!exchanges.length && <option value="">No exchanges configured</option>}
        {exchanges.map(exchange => <option key={exchange.id} value={exchange.id}>{exchange.name}{exchange.apiSupported ? "" : " · API not integrated"}</option>)}
      </select>
    </label>
    <p className="text-sm text-muted-foreground">Each exchange has independent settings. Add exchanges in <Link className="underline" href="/admin/exchanges">Exchange management</Link>. For file imports, use <Link className="underline" href="/admin/ingest/uploads">Uploads</Link>.</p>
    {selected && <SyncControls key={selected.id} exchangeId={selected.id} exchangeSlug={selected.slug} exchangeName={selected.name} apiSupported={selected.apiSupported} />}
  </div>;
}

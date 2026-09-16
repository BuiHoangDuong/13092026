"use client";

import { useCallback, useEffect, useState } from "react";

type Exchange = { id: string; slug: string; name: string; status: "DRAFT" | "PUBLISHED"; defaultCashbackRate: string | null; i18n: unknown };
type Offer = { id: string; exchangeId: string; status: "DRAFT" | "PUBLISHED"; cashbackRate: string; conditions: unknown };
type LinkRow = { id: string; exchangeId: string; offerId: string | null; destination: string; active: boolean };
type Guide = { id: string; slug: string; exchangeId: string | null; status: "DRAFT" | "PUBLISHED"; i18n: unknown };
type State = { exchanges: Exchange[]; offers: Offer[]; links: LinkRow[]; guides: Guide[] };
type Cursors = Record<keyof State, string | null>;

const emptyState: State = { exchanges: [], offers: [], links: [], guides: [] };
const text = (value: unknown, locale: string, field: string) => {
  const record = value as Record<string, Record<string, string>> | null;
  return record?.[locale]?.[field] ?? "";
};
const localizedText = (value: unknown, locale: string) => (value as Record<string, string> | null)?.[locale] ?? "";

export function AdminContentManager() {
  const [data, setData] = useState<State>(emptyState);
  const [cursors, setCursors] = useState<Cursors>({ exchanges: null, offers: null, links: null, guides: null });
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<{ kind: keyof State; id: string } | null>(null);

  const load = useCallback(async () => {
    const [exchangeResult, offerResult, linkResult, guideResult] = await Promise.all([
      fetch("/api/admin/exchanges", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/admin/offers", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/admin/links", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/admin/guides", { cache: "no-store" }).then((response) => response.json())
    ]);
    setData({ exchanges: exchangeResult.exchanges ?? [], offers: offerResult.offers ?? [], links: linkResult.links ?? [], guides: guideResult.guides ?? [] });
    setCursors({ exchanges: exchangeResult.nextCursor ?? null, offers: offerResult.nextCursor ?? null, links: linkResult.nextCursor ?? null, guides: guideResult.nextCursor ?? null });
  }, []);

  useEffect(() => { load().catch(() => setMessage("Could not load admin content.")); }, [load]);

  async function save(endpoint: string, payload: object, id?: string) {
    setMessage("Saving…");
    const response = await fetch(`/api/admin/${endpoint}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id, ...payload } : payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Save failed");
    setEditing(null);
    setMessage("Saved. Public reads now use the new content status.");
    await load();
  }

  async function loadMore(kind: keyof State) {
    const cursor = cursors[kind];
    if (!cursor) return;
    const response = await fetch(`/api/admin/${kind}?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.message ?? "Could not load more content");
    const rows = (result[kind] ?? []) as State[typeof kind];
    setData((current) => ({ ...current, [kind]: [...current[kind], ...rows] }));
    setCursors((current) => ({ ...current, [kind]: result.nextCursor ?? null }));
  }

  const selectedExchange = editing?.kind === "exchanges" ? data.exchanges.find((row) => row.id === editing.id) : undefined;
  const selectedOffer = editing?.kind === "offers" ? data.offers.find((row) => row.id === editing.id) : undefined;
  const selectedLink = editing?.kind === "links" ? data.links.find((row) => row.id === editing.id) : undefined;
  const selectedGuide = editing?.kind === "guides" ? data.guides.find((row) => row.id === editing.id) : undefined;

  return <div className="admin-stack">
    {message && <p className="notice">{message}</p>}
    <Editor title="Exchanges" rows={data.exchanges} onEdit={(id) => setEditing({ kind: "exchanges", id })} label={(row) => `${row.name} · ${row.status}`} onLoadMore={cursors.exchanges ? () => loadMore("exchanges") : undefined}>
      <form key={selectedExchange?.id ?? "new-exchange"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("exchanges", { slug: form.get("slug"), name: form.get("name"), defaultCashbackRate: form.get("rate") || null, status: form.get("status"), i18n: { en: { name: form.get("enName"), description: form.get("enDescription") } } }, selectedExchange?.id).catch((error) => setMessage(error.message));
      }}>
        <input name="slug" placeholder="slug" required defaultValue={selectedExchange?.slug} />
        <input name="name" placeholder="Internal name" required defaultValue={selectedExchange?.name} />
        <input name="rate" placeholder="Rate, e.g. 0.4" defaultValue={selectedExchange?.defaultCashbackRate ?? ""} />
        <StatusSelect value={selectedExchange?.status} />
        <input name="enName" placeholder="English name" required defaultValue={text(selectedExchange?.i18n, "en", "name")} />
        <textarea name="enDescription" placeholder="English description" required defaultValue={text(selectedExchange?.i18n, "en", "description")} />
        <Submit editing={Boolean(selectedExchange)} />
      </form>
    </Editor>

    <Editor title="Offers" rows={data.offers} onEdit={(id) => setEditing({ kind: "offers", id })} label={(row) => `${row.cashbackRate} · ${row.status}`} onLoadMore={cursors.offers ? () => loadMore("offers") : undefined}>
      <form key={selectedOffer?.id ?? "new-offer"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("offers", { exchangeId: form.get("exchangeId"), cashbackRate: form.get("rate"), status: form.get("status"), conditions: { en: form.get("enConditions") } }, selectedOffer?.id).catch((error) => setMessage(error.message));
      }}>
        <ExchangeSelect exchanges={data.exchanges} value={selectedOffer?.exchangeId} />
        <input name="rate" placeholder="Rate, e.g. 0.4" required defaultValue={selectedOffer?.cashbackRate} />
        <StatusSelect value={selectedOffer?.status} />
        <textarea name="enConditions" placeholder="English conditions" required defaultValue={localizedText(selectedOffer?.conditions, "en")} />
        <Submit editing={Boolean(selectedOffer)} />
      </form>
    </Editor>

    <Editor title="Referral links" rows={data.links} onEdit={(id) => setEditing({ kind: "links", id })} label={(row) => `${row.destination} · ${row.active ? "active" : "inactive"}`} onLoadMore={cursors.links ? () => loadMore("links") : undefined}>
      <form key={selectedLink?.id ?? "new-link"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("links", { exchangeId: form.get("exchangeId"), offerId: form.get("offerId") || null, destination: form.get("destination"), active: form.get("active") === "true" }, selectedLink?.id).catch((error) => setMessage(error.message));
      }}>
        <ExchangeSelect exchanges={data.exchanges} value={selectedLink?.exchangeId} />
        <select name="offerId" defaultValue={selectedLink?.offerId ?? ""}><option value="">No offer</option>{data.offers.map((row) => <option key={row.id} value={row.id}>{row.cashbackRate} · {data.exchanges.find((item) => item.id === row.exchangeId)?.name}</option>)}</select>
        <input name="destination" type="url" placeholder="https://…" required defaultValue={selectedLink?.destination} />
        <select name="active" defaultValue={String(selectedLink?.active ?? true)}><option value="true">Active</option><option value="false">Inactive</option></select>
        <Submit editing={Boolean(selectedLink)} />
      </form>
    </Editor>

    <Editor title="Guides" rows={data.guides} onEdit={(id) => setEditing({ kind: "guides", id })} label={(row) => `${row.slug} · ${row.status}`} onLoadMore={cursors.guides ? () => loadMore("guides") : undefined}>
      <form key={selectedGuide?.id ?? "new-guide"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("guides", { slug: form.get("slug"), exchangeId: form.get("exchangeId") || null, status: form.get("status"), i18n: { en: { title: form.get("enTitle"), content: form.get("enContent") } } }, selectedGuide?.id).catch((error) => setMessage(error.message));
      }}>
        <input name="slug" placeholder="guide-slug" required defaultValue={selectedGuide?.slug} />
        <ExchangeSelect exchanges={data.exchanges} value={selectedGuide?.exchangeId ?? ""} optional />
        <StatusSelect value={selectedGuide?.status} />
        <input name="enTitle" placeholder="English title" required defaultValue={text(selectedGuide?.i18n, "en", "title")} />
        <textarea name="enContent" placeholder="English content" required defaultValue={text(selectedGuide?.i18n, "en", "content")} />
        <Submit editing={Boolean(selectedGuide)} />
      </form>
    </Editor>
  </div>;
}

function Editor<T extends { id: string }>({ title, rows, onEdit, label, onLoadMore, children }: { title: string; rows: T[]; onEdit(id: string): void; label(row: T): string; onLoadMore?: () => Promise<void>; children: React.ReactNode }) {
  return <section className="admin-section"><h2>{title}</h2><div className="admin-list">{rows.map((row) => <button type="button" key={row.id} onClick={() => onEdit(row.id)}>{label(row)}</button>)}</div>{onLoadMore && <button type="button" className="load-more" onClick={() => onLoadMore().catch((error) => console.error(error))}>Load more</button>}{children}</section>;
}
function ExchangeSelect({ exchanges, value, optional = false }: { exchanges: Exchange[]; value?: string; optional?: boolean }) {
  return <select name="exchangeId" required={!optional} defaultValue={value ?? ""}><option value="" disabled={!optional}>{optional ? "General" : "Select exchange"}</option>{exchanges.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>;
}
function StatusSelect({ value = "DRAFT" }: { value?: "DRAFT" | "PUBLISHED" }) {
  return <select name="status" defaultValue={value}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select>;
}
function Submit({ editing }: { editing: boolean }) { return <button className="button" type="submit">{editing ? "Update" : "Create"}</button>; }

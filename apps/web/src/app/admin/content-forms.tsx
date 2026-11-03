"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { retainedChoiceId } from "@/lib/retained-choice";

type Exchange = { id: string; slug: string; name: string; status: "DRAFT" | "PUBLISHED"; defaultCashbackRate: string | null; i18n: unknown };
type Offer = { id: string; exchangeId: string; status: "DRAFT" | "PUBLISHED"; cashbackRate: string; conditions: unknown };
type LinkRow = { id: string; exchangeId: string; offerId: string | null; destination: string; active: boolean };
type Guide = { id: string; slug: string; exchangeId: string | null; status: "DRAFT" | "PUBLISHED"; i18n: unknown };

const text = (value: unknown, locale: string, field: string) => {
  const record = value as Record<string, Record<string, string>> | null;
  return record?.[locale]?.[field] ?? "";
};
const localizedText = (value: unknown, locale: string) => (value as Record<string, string> | null)?.[locale] ?? "";

async function readJson(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message ?? "Request failed");
  return result;
}

function useAdminSave(reload: () => Promise<void>) {
  const [message, setMessage] = useState("");
  async function save(endpoint: string, payload: object, id?: string) {
    setMessage("Saving…");
    const result = await readJson(await fetch(`/api/admin/${endpoint}`, {
      method: id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(id ? { id, ...payload } : payload)
    }));
    setMessage("Saved. Public reads now use the new content status.");
    await reload();
    return result;
  }
  return { message, setMessage, save };
}

function useAdminCrudSection<T extends { id: string }>(endpoint: string, listKey: string, loadError: string) {
  const [rows, setRows] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const selected = rows.find((row) => row.id === editingId);
  const load = useCallback(async () => {
    const result = await readJson(await fetch(`/api/admin/${endpoint}`, { cache: "no-store" }));
    setRows((result[listKey] ?? []) as T[]);
    setCursor(result.nextCursor ?? null);
  }, [endpoint, listKey]);
  const { message, setMessage, save } = useAdminSave(async () => { setEditingId(null); await load(); });
  useEffect(() => { load().catch(() => setMessage(loadError)); }, [load, loadError, setMessage]);
  const loadMore = cursor ? async () => {
    const result = await readJson(await fetch(`/api/admin/${endpoint}?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" }));
    setRows((current) => [...current, ...((result[listKey] ?? []) as T[])]);
    setCursor(result.nextCursor ?? null);
  } : undefined;
  return { rows, selected, setEditingId, loadMore, message, setMessage, save };
}

type ExchangeList = { exchanges: Exchange[]; loadMore?: () => Promise<void>; reload: () => Promise<void>; error: string };
const ExchangeListContext = createContext<ExchangeList | null>(null);

export function AdminExchangeListProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const result = await readJson(await fetch("/api/admin/exchanges", { cache: "no-store" }));
    setExchanges(result.exchanges ?? []);
    setCursor(result.nextCursor ?? null);
    setError("");
  }, []);
  const needsList = ["/admin/exchanges", "/admin/offers", "/admin/links", "/admin/guides"].some((path) => pathname === path || pathname.startsWith(`${path}/`));
  useEffect(() => { if (needsList) reload().catch(() => setError("Could not load exchanges.")); }, [needsList, reload]);
  const loadMore = cursor ? async () => {
    const result = await readJson(await fetch(`/api/admin/exchanges?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" }));
    setExchanges((current) => [...current, ...(result.exchanges ?? [])]);
    setCursor(result.nextCursor ?? null);
  } : undefined;
  return <ExchangeListContext.Provider value={{ exchanges, loadMore, reload, error }}>{children}</ExchangeListContext.Provider>;
}

function useExchangeList() {
  const value = useContext(ExchangeListContext);
  if (!value) throw new Error("Admin exchange list is missing");
  return value;
}

function Editor<T extends { id: string }>({ title, rows, onEdit, label, onLoadMore, children }: { title: string; rows: T[]; onEdit(id: string): void; label(row: T): string; onLoadMore?: () => Promise<void>; children: React.ReactNode }) {
  return <section className="admin-section"><h2>{title}</h2><div className="admin-list">{rows.map((row) => <button type="button" key={row.id} onClick={() => onEdit(row.id)}>{label(row)}</button>)}</div>{onLoadMore && <button type="button" className="load-more" onClick={() => onLoadMore().catch((error) => console.error(error))}>Load more</button>}{children}</section>;
}
function ExchangeSelect({ exchanges, value, optional = false }: { exchanges: Exchange[]; value?: string; optional?: boolean }) {
  const [current, setCurrent] = useState(value ?? "");
  const missing = retainedChoiceId(current, exchanges.map((row) => row.id));
  return <select name="exchangeId" required={!optional} value={current} onChange={(event) => setCurrent(event.target.value)}><option value="" disabled={!optional}>{optional ? "General" : "Select exchange"}</option>{missing && <option value={current}>Current exchange (not in loaded list)</option>}{exchanges.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select>;
}
function OfferSelect({ offers, exchanges, value }: { offers: Offer[]; exchanges: Exchange[]; value: string | null | undefined }) {
  const [current, setCurrent] = useState(value ?? "");
  const missing = retainedChoiceId(current, offers.map((row) => row.id));
  return <select name="offerId" value={current} onChange={(event) => setCurrent(event.target.value)}><option value="">No offer</option>{missing && <option value={current}>Current offer (not in loaded list)</option>}{offers.map((row) => <option key={row.id} value={row.id}>{row.cashbackRate} · {exchanges.find((item) => item.id === row.exchangeId)?.name}</option>)}</select>;
}
function StatusSelect({ value = "DRAFT" }: { value?: "DRAFT" | "PUBLISHED" }) {
  return <select name="status" defaultValue={value}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select>;
}
function Submit({ editing }: { editing: boolean }) { return <button className="button" type="submit">{editing ? "Update" : "Create"}</button>; }

export function AdminExchangesSection() {
  const { exchanges, loadMore, reload, error } = useExchangeList();
  const [editingId, setEditingId] = useState<string | null>(null);
  const selected = exchanges.find((row) => row.id === editingId);
  const { message, setMessage, save } = useAdminSave(async () => { setEditingId(null); await reload(); });
  return <div className="admin-stack">{(message || error) && <p className="notice">{message || error}</p>}
    <Editor title="Exchanges" rows={exchanges} onEdit={setEditingId} label={(row) => `${row.name} · ${row.status}`} onLoadMore={loadMore}>
      <form key={selected?.id ?? "new-exchange"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("exchanges", { slug: form.get("slug"), name: form.get("name"), defaultCashbackRate: form.get("rate") || null, status: form.get("status"), i18n: { en: { name: form.get("enName"), description: form.get("enDescription") } } }, selected?.id).catch((error) => setMessage(error.message));
      }}>
        <input name="slug" placeholder="slug" required defaultValue={selected?.slug} />
        <input name="name" placeholder="Internal name" required defaultValue={selected?.name} />
        <input name="rate" placeholder="Rate, e.g. 0.4" defaultValue={selected?.defaultCashbackRate ?? ""} />
        <StatusSelect value={selected?.status} />
        <input name="enName" placeholder="English name" required defaultValue={text(selected?.i18n, "en", "name")} />
        <textarea name="enDescription" placeholder="English description" required defaultValue={text(selected?.i18n, "en", "description")} />
        <Submit editing={Boolean(selected)} />
      </form>
    </Editor>
  </div>;
}

export function AdminOffersSection() {
  const { exchanges } = useExchangeList();
  const { rows, selected, setEditingId, loadMore, message, setMessage, save } = useAdminCrudSection<Offer>("offers", "offers", "Could not load offers.");
  return <div className="admin-stack">{message && <p className="notice">{message}</p>}
    <Editor title="Offers" rows={rows} onEdit={setEditingId} label={(row) => `${row.cashbackRate} · ${row.status}`} onLoadMore={loadMore}>
      <form key={selected?.id ?? "new-offer"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("offers", { exchangeId: form.get("exchangeId"), cashbackRate: form.get("rate"), status: form.get("status"), conditions: { en: form.get("enConditions") } }, selected?.id).catch((error) => setMessage(error.message));
      }}>
        <ExchangeSelect exchanges={exchanges} value={selected?.exchangeId} />
        <input name="rate" placeholder="Rate, e.g. 0.4" required defaultValue={selected?.cashbackRate} />
        <StatusSelect value={selected?.status} />
        <textarea name="enConditions" placeholder="English conditions" required defaultValue={localizedText(selected?.conditions, "en")} />
        <Submit editing={Boolean(selected)} />
      </form>
    </Editor>
  </div>;
}

export function AdminLinksSection() {
  const { exchanges } = useExchangeList();
  const [offers, setOffers] = useState<Offer[]>([]);
  const { rows, selected, setEditingId, loadMore, message, setMessage, save } = useAdminCrudSection<LinkRow>("links", "links", "Could not load referral links.");
  const loadOffers = useCallback(async () => {
    const result = await readJson(await fetch("/api/admin/offers", { cache: "no-store" }));
    setOffers(result.offers ?? []);
  }, []);
  useEffect(() => { loadOffers().catch(() => setMessage("Could not load offers.")); }, [loadOffers, setMessage]);
  return <div className="admin-stack">{message && <p className="notice">{message}</p>}
    <Editor title="Referral links" rows={rows} onEdit={setEditingId} label={(row) => `${row.destination} · ${row.active ? "active" : "inactive"}`} onLoadMore={loadMore}>
      <form key={selected?.id ?? "new-link"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("links", { exchangeId: form.get("exchangeId"), offerId: form.get("offerId") || null, destination: form.get("destination"), active: form.get("active") === "true" }, selected?.id).catch((error) => setMessage(error.message));
      }}>
        <ExchangeSelect exchanges={exchanges} value={selected?.exchangeId} />
        <OfferSelect offers={offers} exchanges={exchanges} value={selected?.offerId} />
        <input name="destination" type="url" placeholder="https://…" required defaultValue={selected?.destination} />
        <select name="active" defaultValue={String(selected?.active ?? true)}><option value="true">Active</option><option value="false">Inactive</option></select>
        <Submit editing={Boolean(selected)} />
      </form>
    </Editor>
  </div>;
}

export function AdminGuidesSection() {
  const { exchanges } = useExchangeList();
  const { rows, selected, setEditingId, loadMore, message, setMessage, save } = useAdminCrudSection<Guide>("guides", "guides", "Could not load guides.");
  return <div className="admin-stack">{message && <p className="notice">{message}</p>}
    <Editor title="Guides" rows={rows} onEdit={setEditingId} label={(row) => `${row.slug} · ${row.status}`} onLoadMore={loadMore}>
      <form key={selected?.id ?? "new-guide"} onSubmit={(event) => {
        event.preventDefault(); const form = new FormData(event.currentTarget);
        save("guides", { slug: form.get("slug"), exchangeId: form.get("exchangeId") || null, status: form.get("status"), i18n: { en: { title: form.get("enTitle"), content: form.get("enContent") } } }, selected?.id).catch((error) => setMessage(error.message));
      }}>
        <input name="slug" placeholder="guide-slug" required defaultValue={selected?.slug} />
        <ExchangeSelect exchanges={exchanges} value={selected?.exchangeId ?? ""} optional />
        <StatusSelect value={selected?.status} />
        <input name="enTitle" placeholder="English title" required defaultValue={text(selected?.i18n, "en", "title")} />
        <textarea name="enContent" placeholder="English content" required defaultValue={text(selected?.i18n, "en", "content")} />
        <Submit editing={Boolean(selected)} />
      </form>
    </Editor>
  </div>;
}

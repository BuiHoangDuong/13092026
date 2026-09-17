"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { withdrawalsResponseSchema, type WithdrawalsResponse } from "@cashback/contracts";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable, DataTableColumnHeader } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { defaultLocale, getMessages } from "@/i18n";

type Withdrawal = WithdrawalsResponse["withdrawals"][number];
type Choice = "APPROVE" | "REJECT" | "MARK_PAID";

export function WithdrawalQueue() {
  const m = getMessages(defaultLocale).withdrawal;
  const [page, setPage] = useState<WithdrawalsResponse | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, { note: string; payoutRef: string }>>({});
  const [pending, setPending] = useState<{ withdrawal: Withdrawal; choice: Choice } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/withdrawals${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? m.unavailable);
      setPage(withdrawalsResponseSchema.parse(body));
    } catch (caught) { setError(caught instanceof Error ? caught.message : m.unavailable); }
  }, [cursor, m.unavailable]);

  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000); return () => clearInterval(timer); }, [load]);

  async function submitDecision() {
    if (!pending) return;
    const draft = drafts[pending.withdrawal.id] ?? { note: "", payoutRef: "" };
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/withdrawals/${pending.withdrawal.id}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: pending.choice, note: draft.note || undefined, ...(pending.choice === "MARK_PAID" ? { payoutRef: draft.payoutRef } : {}) })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? m.unavailable);
      setPending(null); setCursor(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : m.unavailable); }
    finally { setBusy(false); }
  }

  const columns = useMemo<ColumnDef<Withdrawal>[]>(() => [
    { accessorKey: "uid", header: ({ column }) => <DataTableColumnHeader column={column} title={m.uid} />, cell: ({ row }) => <div><p className="font-medium">{row.original.uid}{row.original.isFirst && <span className="ml-2 text-xs text-primary">{m.first}</span>}</p><p className="max-w-44 truncate text-xs text-muted-foreground">{row.original.email}</p></div> },
    { accessorKey: "status", filterFn: "equals", header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />, cell: ({ row }) => m.statuses[row.original.status] },
    { accessorKey: "amount", header: ({ column }) => <DataTableColumnHeader column={column} title={m.amount} />, cell: ({ row }) => `${row.original.amount} ${row.original.asset}` },
    { accessorKey: "network", header: m.network, cell: ({ row }) => <div><p>{row.original.network}</p><p className="max-w-48 truncate text-xs text-muted-foreground" title={row.original.address}>{row.original.address}</p></div> },
    { id: "details", header: "Decision details", enableHiding: false, cell: ({ row }) => {
      const draft = drafts[row.original.id] ?? { note: "", payoutRef: "" };
      return <div className="min-w-48 space-y-2"><Input aria-label={m.note} placeholder={m.note} maxLength={1000} disabled={busy} value={draft.note} onChange={event => setDrafts(current => ({ ...current, [row.original.id]: { ...draft, note: event.target.value } }))} />{["APPROVED", "AUTO_APPROVED"].includes(row.original.status) && <Input aria-label={m.payoutRef} placeholder={m.payoutRef} maxLength={256} disabled={busy} value={draft.payoutRef} onChange={event => setDrafts(current => ({ ...current, [row.original.id]: { ...draft, payoutRef: event.target.value } }))} />}</div>;
    } },
    { id: "actions", header: "Actions", enableHiding: false, cell: ({ row }) => <div className="flex flex-wrap gap-2">{(["APPROVE", "REJECT", "MARK_PAID"] as const).filter(choice => choice !== "APPROVE" || row.original.status === "UNDER_REVIEW").filter(choice => choice !== "MARK_PAID" || ["APPROVED", "AUTO_APPROVED"].includes(row.original.status)).map(choice => <Button key={choice} type="button" size="sm" variant={choice === "REJECT" ? "destructive" : "default"} disabled={busy || (choice === "MARK_PAID" && !drafts[row.original.id]?.payoutRef)} onClick={() => setPending({ withdrawal: row.original, choice })}>{m.actions[choice]}</Button>)}</div> }
  ], [busy, drafts, m]);

  return <section className="mt-10 space-y-4 rounded-lg border border-border bg-card p-6">
    <h2 className="text-2xl font-semibold">{m.queue}</h2><p className="text-sm text-muted-foreground">{m.manualPayout}</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <DataTable data={page?.withdrawals ?? []} columns={columns} searchKey="uid" searchPlaceholder="Filter UID..." filters={[{ columnId: "status", title: "Status", options: Object.entries(m.statuses).map(([value, label]) => ({ value, label })) }]} empty={m.empty} />
    <div className="flex gap-3">{cursor && <Button variant="secondary" onClick={() => setCursor(null)}>{m.newest}</Button>}{page?.nextCursor && <Button variant="secondary" onClick={() => setCursor(page.nextCursor)}>{m.next}</Button>}</div>
    <ConfirmDialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }} title={pending ? m.actions[pending.choice] : m.queue} desc={pending ? m.confirm.replace("{{action}}", m.actions[pending.choice]) : ""} confirmText={pending ? m.actions[pending.choice] : undefined} destructive={pending?.choice === "REJECT"} isLoading={busy} handleConfirm={() => void submitDecision()} />
  </section>;
}

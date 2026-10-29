"use client";

import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";

type Item = { id: string; exchange: string; uid: string; asset: string; entitlement: string; settled: string; remaining: string; paymentStatus: "UNPAID" | "PAID"; closed: boolean; releasedAt: string; executionId: string | null; executionState: string | null; primaryReason: string | null; blockers: string[] };
type Ledger = { items: Item[]; totalsByAsset: Record<string, string> | null; partialTotalsByAsset: Record<string, string>; banner: Record<string, number | boolean> };
type Execution = { id: string; state: string; version: number; total: string };

const reasonText: Record<string, string> = {
  AWAITING_APPROVAL: "Waiting for approval", WAITING_SCHEDULE: "Waiting for the 23:00 UTC payout", RECONCILIATION_REQUIRED: "Result unknown: reconcile before anything else",
  DISPATCHING: "Sending", SYNC_PENDING: "Ledger syncing", SYNC_FAILED: "Ledger sync failed", CORRECTION_PENDING: "Correction pending", RECEIVABLE_OUTSTANDING: "Customer owes a recovery adjustment",
  RECIPIENT_NOT_READY: "Recipient not set up at the exchange", INSUFFICIENT_SOURCE_FUNDS: "Not enough funds in the payout account", MINIMUM_NOT_MET: "Below the minimum, accumulating",
  FEE_NOT_READY: "Fee unknown", CONFIG_MISSING: "Payout channel not configured", TECHNICAL_ERROR: "Technical error, will retry", READY: "Ready"
};
const formatTotals = (totals: Record<string, string> | undefined) => Object.entries(totals ?? {}).map(([asset, amount]) => `${amount} ${asset}`).join(" · ");

export function PayablesLedger() {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [status, setStatus] = useState<"UNPAID" | "PAID" | "ALL">("UNPAID");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ item: Item; execution: Execution; type: "APPROVE" | "CANCEL" } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/payables?status=${status}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Payables unavailable");
      setLedger(body as Ledger); setError("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Payables unavailable"); }
  }, [status]);
  useEffect(() => { void load(); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 30_000); return () => clearInterval(timer); }, [load]);

  async function choose(item: Item, type: "APPROVE" | "CANCEL") {
    if (!item.executionId) return;
    const response = await fetch(`/api/admin/payout-executions/${item.executionId}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) { setError(body.error?.message ?? "Payout unavailable"); return; }
    setPending({ item, execution: { id: body.id, state: body.state, version: body.version, total: body.total }, type });
  }
  async function submit() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/payout-executions/${pending.execution.id}/commands`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: pending.type, commandKey: `ui:${crypto.randomUUID()}`, ...(pending.type === "APPROVE" ? { expectedVersion: pending.execution.version } : {}) }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Command rejected");
      setPending(null); await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Command rejected"); }
    finally { setBusy(false); }
  }

  const banner = ledger?.banner;
  const alerts = banner ? [
    banner.unknownExecutions ? `${banner.unknownExecutions} payout(s) with an unknown result` : "",
    banner.invariantErrors ? `${banner.invariantErrors} ledger invariant error(s)` : "",
    banner.scopesFailed ? `${banner.scopesFailed} sync scope(s) failed` : "",
    banner.failedJobs ? `${banner.failedJobs} failed job(s)` : "",
    banner.pendingCorrection ? `${banner.pendingCorrection} correction(s) waiting on an in-flight payout` : ""
  ].filter(Boolean) : [];

  return <section className="mt-10 space-y-4 rounded-lg border border-border bg-card p-6">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {alerts.length > 0 && <ul role="alert" className="rounded-md border border-destructive p-3 text-sm text-destructive">{alerts.map(alert => <li key={alert}>{alert}</li>)}</ul>}
    {banner && <p className="text-sm text-muted-foreground">Awaiting approval: {String(banner.awaitingApproval)} · In flight: {String(banner.inFlightExecutions)} · Scopes not synced: {String(banner.scopesNotSynced)}</p>}
    <p className="text-sm">{ledger?.totalsByAsset
      ? <>Owed by asset: {formatTotals(ledger.totalsByAsset) || "nothing"}</>
      : <span className="text-muted-foreground">Owed by asset is not final: some scopes are not synced yet (so far {formatTotals(ledger?.partialTotalsByAsset) || "0"})</span>}</p>
    <div className="flex gap-2" role="group" aria-label="Status filter">{(["UNPAID", "PAID", "ALL"] as const).map(option => <Button key={option} type="button" size="sm" variant={status === option ? "default" : "secondary"} onClick={() => setStatus(option)}>{option === "UNPAID" ? "To pay" : option === "PAID" ? "Paid" : "All"}</Button>)}</div>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr className="border-b border-border"><th className="p-2">Exchange</th><th className="p-2">UID</th><th className="p-2">Remaining</th><th className="p-2">Status</th><th className="p-2">Why</th><th className="p-2">Actions</th></tr></thead>
      <tbody>{(ledger?.items ?? []).map(item => <tr key={item.id} className="border-b border-border">
        <td className="p-2">{item.exchange}</td><td className="p-2 font-medium">{item.uid}</td>
        <td className="p-2">{item.remaining} {item.asset}<span className="block text-xs text-muted-foreground">of {item.entitlement}, paid {item.settled}</span></td>
        <td className="p-2">{item.paymentStatus}{item.closed ? " (closed)" : ""}</td>
        <td className="p-2">{item.primaryReason ? reasonText[item.primaryReason] ?? item.primaryReason : "—"}</td>
        <td className="p-2"><div className="flex gap-2">{item.executionId && item.executionState === "AWAITING_APPROVAL" && <Button size="sm" disabled={busy} onClick={() => void choose(item, "APPROVE")}>Approve</Button>}
          {item.executionId && ["AWAITING_APPROVAL", "READY"].includes(item.executionState ?? "") && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void choose(item, "CANCEL")}>Cancel payout</Button>}</div></td>
      </tr>)}</tbody>
    </table>{ledger && ledger.items.length === 0 && <p className="p-4 text-muted-foreground">Nothing to show.</p>}</div>
    <ConfirmDialog open={Boolean(pending)} onOpenChange={open => { if (!open) setPending(null); }} title={pending?.type === "APPROVE" ? "Approve payout" : "Cancel payout"}
      desc={pending ? pending.type === "APPROVE" ? `Approve ${pending.execution.total} ${pending.item.asset} to ${pending.item.exchange} UID ${pending.item.uid}? It is sent at the next 23:00 UTC payout, not immediately. New cashback before then voids this approval.` : "Cancel this payout? The money stays owed and returns to the queue." : ""}
      confirmText={pending?.type === "APPROVE" ? "Approve" : "Cancel payout"} destructive={pending?.type === "CANCEL"} isLoading={busy} handleConfirm={() => void submit()} />
  </section>;
}

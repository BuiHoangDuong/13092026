"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

type SyncView = {
  configured: boolean; enabled: boolean; adminPaused: boolean; intervalMinutes: number; nextRunAt: string | null;
  readiness: { ready: boolean; reason: string | null; checkedAt: string | null; expiresAt: string | null; ipWarning: boolean };
  lastAttemptAt: string | null; lastSuccessAt: string | null; pausedReason: string | null;
  consecutiveFailures: number; note: string;
  coverage: { from: string | null; to: string | null; days: number };
  runs: Array<{ id: string; trigger: string; state: string; changedRows: number; fetchedRows: number | null; safeErrorCode: string | null; createdAt: string; failedLoads: Array<{ id: string; fieldNames: string[] }> }>;
};

async function read(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body as SyncView;
}

function readinessMessage(reason: string | null, exchangeSlug: string, name: string) {
  switch (reason) {
    case "NOT_CHECKED": return "Waiting for the worker to check the connector.";
    case "READINESS_STALE": return "The worker's last check is too old. Check that the worker is running.";
    case "MISSING_KEY": return exchangeSlug === "binance" ? "Set BINANCE_AFFILIATE_API_KEY and BINANCE_AFFILIATE_API_SECRET on the worker." : `Set ${exchangeSlug.toUpperCase()}_AFFILIATE_API_KEY, ${exchangeSlug.toUpperCase()}_AFFILIATE_API_SECRET, and ${exchangeSlug.toUpperCase()}_AFFILIATE_MASTER_UID on the worker.`;
    case "BINANCE_READ_ONLY_REQUIRED": return "Use a Binance key with reading enabled and trading, transfers and withdrawals disabled.";
    case "PERMISSION": return "The key must be read-only with Affiliate as its only permission.";
    case "EXPIRED": return "The Bybit API key has expired.";
    case "ROOT_MISMATCH": return "The worker master UID differs from this connector's saved root. Review the worker configuration.";
    case "CHECK_UNAVAILABLE": return `The worker could not complete the ${name} key check. It will retry shortly.`;
    default: return reason ? `${name} key check failed: ${reason}.` : "Connector is ready.";
  }
}

export function SyncControls({ exchangeId, exchangeSlug, exchangeName, apiSupported }: { exchangeId: string; exchangeSlug: string; exchangeName: string; apiSupported: boolean }) {
  const [view, setView] = useState<SyncView | null>(null);
  const [error, setError] = useState("");
  const [interval, setIntervalValue] = useState("30");
  const [mode, setMode] = useState("manual");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const saving = pendingAction !== null;
  const busy = useRef(false);
  const dirty = useRef(false);
  const revision = useRef(0);
  const refresh = useCallback(async (force = false) => {
    if (!exchangeId || (busy.current && !force)) return;
    const startedAtRevision = revision.current;
    try {
      const next = await fetch(`/api/admin/ingest/connectors/${exchangeId}`, { cache: "no-store" }).then(read);
      if (startedAtRevision !== revision.current) return;
      setView(next);
      if (!dirty.current) { setIntervalValue(String(next.intervalMinutes)); setMode(next.enabled ? "scheduled" : "manual"); }
    }
    catch (cause) { if (startedAtRevision === revision.current) setError(cause instanceof Error ? cause.message : "Unable to load sync"); }
  }, [exchangeId]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000); return () => { revision.current++; clearInterval(timer); }; }, [refresh]);
  async function mutate(action: string, url: string, options: RequestInit, resetDraft = false) {
    if (!exchangeId || busy.current) return;
    setError("");
    busy.current = true;
    setPendingAction(action);
    const startedAtRevision = ++revision.current;
    try {
      const next = await fetch(url, options).then(read);
      if (startedAtRevision !== revision.current) return;
      if (resetDraft) dirty.current = false;
      if ("enabled" in next && "readiness" in next) {
        setView(next);
        if (!dirty.current) { setIntervalValue(String(next.intervalMinutes)); setMode(next.enabled ? "scheduled" : "manual"); }
      } else await refresh(true);
    } catch (cause) { if (startedAtRevision === revision.current) setError(cause instanceof Error ? cause.message : "Sync request failed"); }
    finally {
      busy.current = false;
      if (startedAtRevision === revision.current) { revision.current++; setPendingAction(null); }
    }
  }
  function save() {
    return mutate("save", `/api/admin/ingest/connectors/${exchangeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: mode === "scheduled", intervalMinutes: Number(interval) }) }, true);
  }
  function run(path: "run" | "pause" | "resume") {
    return mutate(path, `/api/admin/ingest/connectors/${exchangeId}/${path}`, { method: "POST" });
  }
  function retransform(loadId: string) {
    return mutate("transform", `/api/admin/ingest/loads/${loadId}/retransform`, { method: "POST" });
  }
  return <section className="mt-8 space-y-4">
    <h2 className="text-lg font-semibold">{exchangeName} sync settings</h2>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">{view?.note}</p>
    <p className="text-sm font-medium" role="status" aria-live="polite">Sync status: {view ? view.adminPaused ? "Paused by admin" : view.pausedReason ? "Paused after an error" : view.enabled ? "Scheduled" : "Manual" : "Loading..."}</p>
    <p className="text-sm" role="status">{!apiSupported ? "This exchange's API connector is not integrated. You can save its interval preference; automatic and manual API runs are unavailable." : view ? readinessMessage(view.readiness.reason, exchangeSlug, exchangeName) : "Loading worker readiness..."} {view?.readiness.checkedAt ? `Checked ${new Date(view.readiness.checkedAt).toLocaleString()}.` : ""} {view?.pausedReason ? `Paused: ${view.pausedReason}.` : ""}</p>
    {view?.readiness.ipWarning && <p className="text-sm text-amber-500">The {exchangeName} key has no IP allowlist. Sync is allowed; review the worker's outbound IP restrictions.</p>}
    {view?.readiness.expiresAt && <p className="text-sm text-muted-foreground">Key expiry: {new Date(view.readiness.expiresAt).toLocaleString()}.</p>}
    <p className="text-sm">Coverage {view?.coverage.days ?? 0} days{view?.coverage.from ? ` from ${view.coverage.from} to ${view.coverage.to}` : ""}. Next run {view?.adminPaused || view?.pausedReason ? "paused" : view?.nextRunAt ? new Date(view.nextRunAt).toLocaleString() : "not scheduled"}. Last success {view?.lastSuccessAt ? new Date(view.lastSuccessAt).toLocaleString() : "none"}.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Mode
        <select className="mt-1 block rounded-md border border-border bg-background p-2" value={mode} disabled={!view || saving} onChange={event => { dirty.current = true; setMode(event.target.value); }}>
          <option value="manual">Manual · run on demand</option>
          <option value="scheduled" disabled={!apiSupported || (!view?.enabled && !view?.readiness.ready)}>Scheduled · automatic sync</option>
        </select>
      </label>
      <label className="text-sm">Regular sync interval
        <select className="mt-1 block rounded-md border border-border bg-background p-2" disabled={!view || saving} value={interval} onChange={(event) => { dirty.current = true; setIntervalValue(event.target.value); }}>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="720">12 hours</option>
          <option value="1440">24 hours</option>
        </select>
      </label>
      <Button type="button" onClick={() => void save()} disabled={!view || saving || (String(view.intervalMinutes) === interval && view.enabled === (mode === "scheduled")) || (mode === "scheduled" && (!apiSupported || (!view.enabled && !view.readiness.ready)))}>{pendingAction === "save" ? "Saving..." : "Save settings"}</Button>
      <Button type="button" variant="outline" onClick={() => void run("pause")} disabled={saving || !apiSupported || !view || view.adminPaused}>{pendingAction === "pause" ? "Pausing..." : "Pause sync"}</Button>
      <Button type="button" variant="outline" onClick={() => void run("resume")} disabled={saving || !apiSupported || !view || (!view.adminPaused && (!view.readiness.ready || !view.pausedReason))}>{pendingAction === "resume" ? "Resuming..." : view?.adminPaused ? "Resume sync" : "Resume after fix"}</Button>
      <Button type="button" variant="outline" onClick={() => void run("run")} disabled={saving || !apiSupported || !view?.readiness.ready || Boolean(view.adminPaused || view.pausedReason)}>{pendingAction === "run" ? "Starting..." : "Sync now"}</Button>
    </div>
    <p className="text-xs text-muted-foreground">Pause sync stops new API runs for this exchange only and keeps its saved mode and interval. A day already being fetched may finish. Resume sync restores that saved mode; unresolved errors still require a fix. Manual stops automatic scheduling but allows Sync now when ready.</p>
    <ul className="space-y-1 text-sm">
      {view?.runs.map((run) => <li key={run.id}>{run.createdAt.slice(0, 16)} · {run.trigger} · {run.state} · {run.fetchedRows !== null && run.fetchedRows !== undefined ? `${run.fetchedRows} fetched` : `${run.changedRows} changed`}{run.safeErrorCode ? ` · ${run.safeErrorCode}` : ""}
        {run.failedLoads?.map((load) => <span key={load.id}> · {load.fieldNames.join(", ")} <Button type="button" variant="outline" disabled={saving} onClick={() => void retransform(load.id)}>Re-run transform</Button></span>)}
      </li>)}
      {!view?.runs.length && <li className="text-muted-foreground">No sync runs yet.</li>}
    </ul>
  </section>;
}

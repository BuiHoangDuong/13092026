"use client";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type SyncView = {
  configured: boolean; enabled: boolean; intervalMinutes: number; nextRunAt: string | null;
  readiness: { ready: boolean; reason: string | null; checkedAt: string | null; expiresAt: string | null; ipWarning: boolean };
  lastAttemptAt: string | null; lastSuccessAt: string | null; pausedReason: string | null;
  consecutiveFailures: number; note: string;
  coverage: { from: string | null; to: string | null; days: number };
  runs: Array<{ id: string; trigger: string; state: string; changedRows: number; safeErrorCode: string | null; createdAt: string; failedLoads: Array<{ id: string; fieldNames: string[] }> }>;
};

async function read(response: Response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body as SyncView;
}

function readinessMessage(reason: string | null, exchangeSlug: "bybit" | "mexc") {
  const name = exchangeSlug === "bybit" ? "Bybit" : "MEXC";
  switch (reason) {
    case "NOT_CHECKED": return "Waiting for the worker to check the connector.";
    case "READINESS_STALE": return "The worker's last check is too old. Check that the worker is running.";
    case "MISSING_KEY": return `Set ${exchangeSlug.toUpperCase()}_AFFILIATE_API_KEY, ${exchangeSlug.toUpperCase()}_AFFILIATE_API_SECRET, and ${exchangeSlug.toUpperCase()}_AFFILIATE_MASTER_UID on the worker.`;
    case "PERMISSION": return "The key must be read-only with Affiliate as its only permission.";
    case "EXPIRED": return "The Bybit API key has expired.";
    case "ROOT_MISMATCH": return "The worker master UID differs from this connector's saved root. Review the worker configuration.";
    case "CHECK_UNAVAILABLE": return `The worker could not complete the ${name} key check. It will retry shortly.`;
    default: return reason ? `${name} key check failed: ${reason}.` : "Connector is ready.";
  }
}

export function SyncControls({ exchangeId, exchangeSlug }: { exchangeId: string | null; exchangeSlug: "bybit" | "mexc" }) {
  const exchangeName = exchangeSlug === "bybit" ? "Bybit" : "MEXC";
  const [view, setView] = useState<SyncView | null>(null);
  const [error, setError] = useState("");
  const [interval, setIntervalValue] = useState("30");
  const refresh = useCallback(async () => {
    if (!exchangeId) return;
    try { const next = await fetch(`/api/admin/ingest/connectors/${exchangeId}`, { cache: "no-store" }).then(read); setView(next); setIntervalValue(String(next.intervalMinutes)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load sync"); }
  }, [exchangeId]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 30000); return () => clearInterval(timer); }, [refresh]);
  async function save(enabled: boolean) {
    if (!exchangeId) return;
    setError("");
    try {
      setView(await fetch(`/api/admin/ingest/connectors/${exchangeId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, intervalMinutes: Number(interval) }) }).then(read));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Update failed"); }
  }
  async function run(path: string) {
    if (!exchangeId) return;
    setError("");
    try { await fetch(`/api/admin/ingest/connectors/${exchangeId}/${path}`, { method: "POST" }).then(read); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Sync request failed"); }
  }
  async function retransform(loadId: string) {
    setError("");
    try { await fetch(`/api/admin/ingest/loads/${loadId}/retransform`, { method: "POST" }).then(read); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to re-run transform"); }
  }
  if (!exchangeId) return <p className="mt-8">Publish the {exchangeName} exchange before configuring sync.</p>;
  return <section className="mt-8 space-y-4">
    <h2 className="text-lg font-semibold">{exchangeName} Affiliate</h2>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <p className="text-sm text-muted-foreground">{view?.note}</p>
    <p className="text-sm" role="status">{view ? readinessMessage(view.readiness.reason, exchangeSlug) : "Loading worker readiness..."} {view?.readiness.checkedAt ? `Checked ${new Date(view.readiness.checkedAt).toLocaleString()}.` : ""} {view?.pausedReason ? `Paused: ${view.pausedReason}.` : ""}</p>
    {view?.readiness.ipWarning && <p className="text-sm text-amber-500">The {exchangeName} key has no IP allowlist. Sync is allowed; review the key expiry below.</p>}
    {view?.readiness.expiresAt && <p className="text-sm text-muted-foreground">Key expiry: {new Date(view.readiness.expiresAt).toLocaleString()}.</p>}
    <p className="text-sm">Coverage {view?.coverage.days ?? 0} days{view?.coverage.from ? ` from ${view.coverage.from} to ${view.coverage.to}` : ""}. Next run {view?.nextRunAt ? new Date(view.nextRunAt).toLocaleString() : "not scheduled"}. Last success {view?.lastSuccessAt ? new Date(view.lastSuccessAt).toLocaleString() : "none"}.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Interval
        <select className="mt-1 block rounded-md border border-border bg-background p-2" value={interval} onChange={(event) => setIntervalValue(event.target.value)}>
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="720">12 hours</option>
          <option value="1440">24 hours</option>
        </select>
      </label>
      <Button type="button" variant="outline" onClick={() => void save(view?.enabled ?? false)} disabled={!view || String(view.intervalMinutes) === interval}>Save interval</Button>
      <Button type="button" onClick={() => void save(true)} disabled={!view?.readiness.ready || view.enabled}>Enable</Button>
      <Button type="button" variant="outline" onClick={() => void save(false)} disabled={!view?.enabled}>Disable</Button>
      <Button type="button" variant="outline" onClick={() => void run("run")} disabled={!view?.readiness.ready || Boolean(view.pausedReason)}>Sync now</Button>
      <Button type="button" variant="outline" onClick={() => void run("resume")} disabled={!view?.readiness.ready || !view.pausedReason}>Resume</Button>
    </div>
    <ul className="space-y-1 text-sm">
      {view?.runs.map((run) => <li key={run.id}>{run.createdAt.slice(0, 16)} · {run.trigger} · {run.state} · {run.changedRows} changed{run.safeErrorCode ? ` · ${run.safeErrorCode}` : ""}
        {run.failedLoads?.map((load) => <span key={load.id}> · {load.fieldNames.join(", ")} <Button type="button" variant="outline" onClick={() => void retransform(load.id)}>Re-run transform</Button></span>)}
      </li>)}
      {!view?.runs.length && <li className="text-muted-foreground">No sync runs yet.</li>}
    </ul>
  </section>;
}

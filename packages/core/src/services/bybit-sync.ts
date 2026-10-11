import { db, Prisma, type ActivityDayState, type ExchangeSyncConfig, type SyncTrigger, type RawLoad } from "@cashback/db";
import { binanceAffiliateContract, binanceCredentials, checkBinanceKey, fetchBinanceDay } from "../ingest/binance-affiliate.js";
import { bybitAffiliateContract, mexcAffiliateContract, signBybit } from "../ingest/contract.js";
import { assessQueryApi, fetchAffiliateDay, mapAffiliateRecords, SyncError, type Readiness } from "../ingest/bybit-affiliate.js";
import { fetchMexcDay, fetchMexcPage, mapMexcRecords, minimizeMexcRecords } from "../ingest/mexc-affiliate.js";
import { publishApiDay } from "../ingest/api-sink.js";
import { readRawApi, readRawRows, sliceKey, writeRawLoad } from "../ingest/raw-landing.js";
import { heartbeat, lockActivityPeriod, withJobLease, type JobLease } from "./jobs.js";

const INTERVALS = [30, 60, 720, 1440] as const;
const ACTIVITY_API_EXCHANGES = ["bybit", "mexc", "binance"];
const credentialsFor = (slug: string) => slug === "bybit" ? bybitCredentials() : slug === "binance" ? binanceCredentials() : mexcCredentials();
const readinessFor = (slug: string, fetchImpl?: typeof fetch) => slug === "bybit" ? bybitReadiness(fetchImpl) : slug === "binance" ? binanceReadiness(fetchImpl) : mexcReadiness(fetchImpl);
const contractFor = (slug: string) => slug === "bybit" ? bybitAffiliateContract : slug === "binance" ? binanceAffiliateContract : mexcAffiliateContract;
function validateBinanceDates(dates: string[]) {
  const today = dayStamp(new Date());
  if (!dates.length || dates.length > 7 || new Set(dates).size !== dates.length || dates.some(day => {
    const stamp = Date.parse(`${day}T00:00:00.000Z`);
    return !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(stamp) || day < addDays(today, -6) || day > today || dayStamp(new Date(stamp)) !== day;
  })) throw new SyncError("BINANCE_RANGE", "QUARANTINE", "Binance GET-only runs cover up to seven recent UTC days");
}

export async function listSyncExchanges() {
  const exchanges = await db.exchange.findMany({ select: { id: true, slug: true, name: true }, orderBy: { name: "asc" } });
  return exchanges.map(exchange => ({ ...exchange, apiSupported: ACTIVITY_API_EXCHANGES.includes(exchange.slug) }));
}
const READINESS_MAX_AGE_MS = 5 * 60_000;
export type SyncInterval = (typeof INTERVALS)[number];

export function bybitCredentials() {
  const apiKey = process.env.BYBIT_AFFILIATE_API_KEY ?? "";
  const apiSecret = process.env.BYBIT_AFFILIATE_API_SECRET ?? "";
  const rootAccount = process.env.BYBIT_AFFILIATE_MASTER_UID ?? "";
  return { apiKey, apiSecret, rootAccount, configured: Boolean(apiKey && apiSecret && rootAccount) };
}

export function mexcCredentials() {
  const apiKey = process.env.MEXC_AFFILIATE_API_KEY ?? "";
  const apiSecret = process.env.MEXC_AFFILIATE_API_SECRET ?? "";
  const rootAccount = process.env.MEXC_AFFILIATE_MASTER_UID ?? "";
  return { apiKey, apiSecret, rootAccount, configured: Boolean(apiKey && apiSecret && rootAccount) };
}

function dayStamp(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, delta: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return dayStamp(date);
}

export function dayState(day: string, today = dayStamp(new Date())): ActivityDayState {
  if (day === today) return "OPEN";
  const age = (Date.parse(`${today}T00:00:00.000Z`) - Date.parse(`${day}T00:00:00.000Z`)) / 86_400_000;
  return age <= 2 ? "SETTLING" : "SEALED";
}

export function openWindow(today = dayStamp(new Date())) {
  return [today, addDays(today, -1), addDays(today, -2)];
}

function nextSlot(due: Date, intervalMinutes: number, now: Date) {
  let next = new Date(due.getTime() + intervalMinutes * 60_000);
  while (next.getTime() <= now.getTime()) next = new Date(next.getTime() + intervalMinutes * 60_000);
  return next;
}

async function reserveSlot(id: string, milliseconds: number) {
  const rows = await db.$queryRaw<Array<{ sendAt: Date }>>`
    UPDATE "SyncRateSlot"
    SET "nextRequestAt" = GREATEST("nextRequestAt", clock_timestamp()) + (${milliseconds} * interval '1 millisecond')
    WHERE id = ${id}
    RETURNING "nextRequestAt" - (${milliseconds} * interval '1 millisecond') AS "sendAt"`;
  const sendAt = rows[0]?.sendAt;
  if (!sendAt) throw new SyncError("RATE_SLOT_MISSING", "PAUSE", "Affiliate rate slot is missing");
  const wait = new Date(sendAt).getTime() - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

const reserveBybitSlot = () => reserveSlot("bybit-affiliate", 100);
const reserveMexcSlot = () => reserveSlot("mexc-affiliate", 250);
const reserveBinanceSlot = () => reserveSlot("binance-affiliate", 1500);
async function deferBinanceSlot(milliseconds: number) {
  await db.$executeRaw`UPDATE "SyncRateSlot" SET "nextRequestAt" = GREATEST("nextRequestAt", clock_timestamp() + (${milliseconds} * interval '1 millisecond')) WHERE id = 'binance-affiliate'`;
}
export async function binanceReadiness(fetchImpl: typeof fetch = fetch): Promise<Readiness> {
  const credentials = binanceCredentials();
  if (!credentials.configured) return { ready: false, reason: "MISSING_KEY", expiresAt: null, expiryWarning: false, ipWarning: false };
  await db.syncRateSlot.upsert({ where: { id: "binance-affiliate" }, create: { id: "binance-affiliate", nextRequestAt: new Date() }, update: {} });
  const slot = await db.syncRateSlot.findUniqueOrThrow({ where: { id: "binance-affiliate" } });
  if (slot.nextRequestAt.getTime() > Date.now() + 5000) throw new SyncError("BINANCE_COOLDOWN", "RETRY", "Binance rate limit cooldown");
  try { return await checkBinanceKey({ ...credentials, fetchImpl, reserve: reserveBinanceSlot, onThrottle: deferBinanceSlot }); }
  catch (error) {
    if (error instanceof SyncError && error.action !== "RETRY") return { ready: false, reason: error.code, expiresAt: null, expiryWarning: false, ipWarning: false };
    throw error;
  }
}

export async function mexcReadiness(fetchImpl: typeof fetch = fetch): Promise<Readiness> {
  const credentials = mexcCredentials();
  if (!credentials.configured) return { ready: false, reason: "MISSING_KEY", expiresAt: null, expiryWarning: false, ipWarning: false };
  const day = dayStamp(new Date(Date.now() - 86_400_000));
  const startTime = Date.parse(`${day}T00:00:00.000Z`);
  try {
    await fetchMexcPage({ startTime, endTime: startTime + 86_400_000 - 1, page: 1,
      apiKey: credentials.apiKey, apiSecret: credentials.apiSecret,
      baseUrl: process.env.MEXC_API_BASE, fetchImpl });
    return { ready: true, reason: null, expiresAt: null, expiryWarning: false, ipWarning: false };
  } catch (error) {
    if (error instanceof SyncError && error.action !== "RETRY") return { ready: false, reason: error.code, expiresAt: null, expiryWarning: false, ipWarning: false };
    throw error;
  }
}

export async function bybitReadiness(fetchImpl: typeof fetch = fetch): Promise<Readiness> {
  const credentials = bybitCredentials();
  if (!credentials.configured) return { ready: false, reason: "MISSING_KEY", expiresAt: null, expiryWarning: false, ipWarning: false };
  const timestamp = Date.now().toString();
  const base = (process.env.BYBIT_API_BASE ?? "https://api.bybit.com").replace(/\/$/, "");
  const response = await fetchImpl(`${base}/v5/user/query-api`, {
    headers: {
      "X-BAPI-API-KEY": credentials.apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-RECV-WINDOW": "5000",
      "X-BAPI-SIGN": signBybit(credentials.apiSecret, timestamp, credentials.apiKey, "5000", "")
    },
    signal: AbortSignal.timeout(5000)
  });
  // Transient failures must retry, not pause the connector.
  if (response.status === 429 || response.status >= 500) throw new SyncError(`HTTP_${response.status}`, "RETRY", "Bybit key check is temporarily unavailable");
  if (response.status === 401 || response.status === 403) return { ready: false, reason: `HTTP_${response.status}`, expiresAt: null, expiryWarning: false, ipWarning: false };
  let body: { retCode?: number; result?: { readOnly?: number; permissions?: Record<string, string[]>; ips?: string[]; expiredAt?: string } };
  try { body = await response.json() as typeof body; }
  catch { throw new SyncError("NON_JSON", "RETRY", "Bybit key check returned a non-JSON response"); }
  if (body.retCode === 10006) throw new SyncError("BYBIT_10006", "RETRY", "Bybit key check is rate limited");
  if (body.retCode !== 0) return { ready: false, reason: `BYBIT_${body.retCode ?? response.status}`, expiresAt: null, expiryWarning: false, ipWarning: false };
  return assessQueryApi(body.result ?? null);
}

/** The worker is the only process that probes exchanges or reads credentials. */
async function refreshReadiness(slug: "bybit" | "mexc" | "binance", fetchImpl: typeof fetch, now: Date) {
  const exchange = await db.exchange.findUnique({ where: { slug }, select: { id: true } });
  if (!exchange) return;
  const current = await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchange.id } });
  const credentials = credentialsFor(slug);
  let check: Readiness;
  try {
    check = await readinessFor(slug, fetchImpl);
  } catch {
    check = { ready: false, reason: "CHECK_UNAVAILABLE", expiresAt: null, expiryWarning: false, ipWarning: false };
  }
  const rootMismatch = slug !== "binance" && credentials.configured && current?.rootAccount !== undefined &&
    current.rootAccount !== "unconfigured" && current.rootAccount !== credentials.rootAccount;
  const rootAccount = slug === "binance" ? credentials.rootAccount || current?.rootAccount || "unconfigured" : current?.rootAccount && current.rootAccount !== "unconfigured"
    ? current.rootAccount : credentials.rootAccount || "unconfigured";
  const data = {
    rootAccount,
    credentialsConfigured: credentials.configured,
    readinessReady: check.ready && !rootMismatch,
    readinessReason: rootMismatch ? "ROOT_MISMATCH" : check.reason,
    readinessCheckedAt: now,
    readinessExpiresAt: check.expiresAt && !Number.isNaN(Date.parse(check.expiresAt)) ? new Date(check.expiresAt) : null,
    readinessIpWarning: check.ipWarning,
    ...(rootMismatch ? { pausedReason: "ROOT_MISMATCH" } : {}),
    ...(slug === "binance" && credentials.configured && current?.rootAccount !== credentials.rootAccount ? { pausedReason: null } : {})
  };
  await db.exchangeSyncConfig.upsert({
    where: { exchangeId: exchange.id },
    create: { exchangeId: exchange.id, backfillDays: slug === "binance" ? 0 : slug === "mexc" ? 30 : 365, ...data },
    update: { ...data, ...(slug === "binance" ? { backfillDays: 0, lastFetchedPeriodEnd: current?.rootAccount !== rootAccount ? null : current?.lastFetchedPeriodEnd } : slug === "mexc" ? { backfillDays: 30 } : {}) }
  });
}

export const refreshBybitReadiness = (fetchImpl: typeof fetch = fetch, now = new Date()) => refreshReadiness("bybit", fetchImpl, now);
export const refreshMexcReadiness = (fetchImpl: typeof fetch = fetch, now = new Date()) => refreshReadiness("mexc", fetchImpl, now);
export const refreshBinanceReadiness = (fetchImpl: typeof fetch = fetch, now = new Date()) => refreshReadiness("binance", fetchImpl, now);

function recentReadiness(config: ExchangeSyncConfig | null, now = new Date()) {
  if (!config?.readinessCheckedAt) return { ready: false, reason: "NOT_CHECKED", checkedAt: null };
  const checkedAt = config.readinessCheckedAt.toISOString();
  if (now.getTime() - config.readinessCheckedAt.getTime() > READINESS_MAX_AGE_MS) {
    return { ready: false, reason: "READINESS_STALE", checkedAt };
  }
  return { ready: config.readinessReady, reason: config.readinessReason, checkedAt };
}

function requireRecentReadiness(config: ExchangeSyncConfig | null): asserts config is ExchangeSyncConfig {
  const status = recentReadiness(config);
  if (!status.ready) {
    const reason = status.reason ?? "NOT_READY";
    throw new SyncError(reason, "PAUSE", `Connector is not ready: ${reason}`);
  }
}

/** Pending non-backfill SYNC job. Backfill jobs are queued hours ahead and must not block scheduled runs. */
async function hasPendingSync(exchangeId: string) {
  return db.job.count({ where: {
    type: "SYNC", state: { in: ["PENDING", "CLAIMED"] },
    AND: [{ payload: { path: ["exchangeId"], equals: exchangeId } }, { NOT: { payload: { path: ["trigger"], equals: "BACKFILL" } } }]
  } });
}

async function enqueue(exchangeId: string, rootAccount: string, trigger: SyncTrigger, dates: string[], runAfter = new Date()) {
  const active = await db.syncRun.count({ where: { exchangeId, rootAccount, state: { in: ["QUEUED", "RUNNING"] }, NOT: { trigger: "BACKFILL" } } });
  if (active || await hasPendingSync(exchangeId)) return false;
  await db.job.create({ data: { type: "SYNC", runAfter, payload: { exchangeId, trigger, dates } } });
  return true;
}

export async function scheduleDueSyncs(now = new Date()) {
  const due = await db.exchangeSyncConfig.findMany({ where: { enabled: true, pausedReason: null, nextRunAt: { lte: now } } });
  for (const config of due) {
    // Claim the slot first: only the replica whose conditional update wins may enqueue.
    // A slot skipped because a run is still active is not replayed (no burst after downtime).
    const claimed = await db.exchangeSyncConfig.updateMany({
      where: { exchangeId: config.exchangeId, nextRunAt: config.nextRunAt },
      data: { nextRunAt: nextSlot(config.nextRunAt ?? now, config.intervalMinutes, now), lastAttemptAt: now }
    });
    if (claimed.count) await enqueue(config.exchangeId, config.rootAccount, "SCHEDULED", openWindow(dayStamp(now)));
  }
  const ready = await db.exchangeSyncConfig.findMany({ where: { enabled: true, pausedReason: null } });
  const today = dayStamp(now);
  for (const config of ready) {
    const exchange = await db.exchange.findUnique({ where: { id: config.exchangeId }, select: { slug: true } });
    if (exchange?.slug === "binance") continue; // GET-only: no unverified historical reconciliation.
    const reconciled = await db.syncRun.count({ where: { exchangeId: config.exchangeId, trigger: "RECONCILE", createdAt: { gte: new Date(`${today}T00:00:00.000Z`) } } });
    if (reconciled) continue;
    const dates = Array.from({ length: 30 }, (_, index) => addDays(today, -(index + 3)));
    await enqueue(config.exchangeId, config.rootAccount, "RECONCILE", dates);
  }
  await db.syncRun.updateMany({
    where: { state: "RUNNING", startedAt: { lt: new Date(now.getTime() - 15 * 60_000) } },
    data: { state: "FAILED", safeErrorCode: "WORKER_LOST", finishedAt: now }
  });
}

async function finishRun(runId: string, state: "SUCCEEDED" | "FAILED" | "QUARANTINED" | "PAUSED", patch: Prisma.SyncRunUpdateInput, failures?: { exchangeId: string; pause?: string }) {
  await db.syncRun.update({ where: { id: runId }, data: { state, finishedAt: new Date(), ...patch } });
  if (!failures) return;
  const config = await db.exchangeSyncConfig.findUnique({ where: { exchangeId: failures.exchangeId } });
  if (!config) return;
  const consecutiveFailures = state === "SUCCEEDED" ? 0 : config.consecutiveFailures + 1;
  await db.exchangeSyncConfig.update({
    where: { exchangeId: failures.exchangeId },
    data: {
      consecutiveFailures,
      lastSuccessAt: state === "SUCCEEDED" ? new Date() : config.lastSuccessAt,
      // Only permanent causes pause (Req 13.7). Repeated transient failures alert and keep retrying.
      pausedReason: failures.pause ?? config.pausedReason
    }
  });
  if (consecutiveFailures >= 2 || failures.pause) console.error(JSON.stringify({ event: "cashback_sync_alert", exchangeId: failures.exchangeId, state, pause: failures.pause ?? null }));
}

export async function runSyncJob(lease: JobLease, payload: { exchangeId?: string; trigger?: SyncTrigger; dates?: string[] }, fetchImpl?: typeof fetch) {
  const exchangeId = payload.exchangeId;
  const dates = payload.dates ?? [];
  const trigger = payload.trigger ?? "MANUAL";
  if (!exchangeId || !dates.length) throw new Error("SYNC payload is missing a period");
  const [config, exchange] = await Promise.all([
    db.exchangeSyncConfig.findUnique({ where: { exchangeId } }),
    db.exchange.findUnique({ where: { id: exchangeId }, select: { slug: true } })
  ]);
  const slug = exchange?.slug;
  if (slug !== "bybit" && slug !== "mexc" && slug !== "binance") throw new SyncError("UNSUPPORTED", "QUARANTINE", "Exchange has no API connector");
  if (slug === "binance") validateBinanceDates(dates);
  const credentials = credentialsFor(slug);
  const contract = contractFor(slug);
  if (!config || !credentials.configured) throw new SyncError("MISSING_KEY", "PAUSE", "Affiliate credentials are not configured");
  if (config.rootAccount !== credentials.rootAccount) {
    await db.exchangeSyncConfig.update({ where: { exchangeId }, data: { pausedReason: "ROOT_MISMATCH" } });
    return withJobLease(lease, async () => {});
  }
  if (["SCHEDULED", "BACKFILL", "RECONCILE"].includes(trigger) && (!config.enabled || config.pausedReason)) return withJobLease(lease, async () => {});
  const readiness = await readinessFor(slug, fetchImpl);
  if (!readiness.ready) {
    // Pause but keep the admin's enabled choice, so Resume restores the schedule after the fix.
    await db.exchangeSyncConfig.update({ where: { exchangeId }, data: { pausedReason: readiness.reason } });
    return withJobLease(lease, async () => {});
  }
  let run;
  try {
    run = await db.syncRun.create({ data: {
      exchangeId, rootAccount: config.rootAccount, trigger, state: "RUNNING", contractVersion: contract.version, startedAt: new Date(), checkpoint: { expectedDays: dates.length }
    } });
  } catch (error) {
    // Another run holds the one-active-run index: requeue instead of burning retry attempts.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return withJobLease(lease, async (tx) => {
        await tx.job.create({ data: { type: "SYNC", runAfter: new Date(Date.now() + 60_000), payload: { exchangeId, trigger, dates } } });
      });
    }
    throw error;
  }
  const today = dayStamp(new Date());
  try {
    const roster = await db.activityRoster.count({ where: { exchangeId, rootAccount: config.rootAccount, state: "ACTIVE" } });
    for (const day of dates) {
      await heartbeat(lease, Number(process.env.JOB_LEASE_SECONDS ?? 120));
      const fetched = slug === "binance"
        ? await fetchBinanceDay({ day, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret, fetchImpl, reserve: reserveBinanceSlot, onThrottle: deferBinanceSlot })
        : slug === "bybit"
        ? await fetchAffiliateDay({ day, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret,
          baseUrl: process.env.BYBIT_API_BASE, fetchImpl, reserve: reserveBybitSlot })
        : await fetchMexcDay({ day, apiKey: credentials.apiKey, apiSecret: credentials.apiSecret,
          baseUrl: process.env.MEXC_API_BASE, fetchImpl, reserve: reserveMexcSlot });
      if (!fetched.records.length && roster > 0 && slug === "bybit")
        throw new SyncError("EMPTY_PERIOD", "QUARANTINE", "Bybit returned no rows for a known roster");
      const records = slug === "mexc" ? minimizeMexcRecords(fetched.records) : fetched.records;
      const raw = readRawApi(records, contract);
      const start = new Date(`${day}T00:00:00.000Z`);
      const end = new Date(start.getTime() + 86_400_000 - 1);
      await writeRawLoad({ exchangeId, sourceSystem: slug, datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "OFFICIAL_API",
        rootAccount: config.rootAccount, periodStart: start, periodEnd: end, runId: run.id, records: raw.records,
        fieldNames: raw.fieldNames, sourceMetadata: { day, observedAt: fetched.observedAt.toISOString(), dayState: dayState(day, today), updateRoster: String(slug === "bybit" && day === today) } }, lease);
    }
    return withJobLease(lease, async () => {});
  } catch (error) {
    const syncError = error instanceof SyncError ? error : new SyncError("RETRY", "RETRY", error instanceof Error ? error.message : "Sync failed");
    const state = syncError.action === "PAUSE" ? "PAUSED" : syncError.action === "QUARANTINE" ? "QUARANTINED" : "FAILED";
    // A breaking schema change quarantines the run AND pauses the connector until a fix is deployed (UC8).
    const pause = syncError.action === "PAUSE" || syncError.code === "SCHEMA_DRIFT" ? syncError.code : undefined;
    await finishRun(run.id, state, {
      safeErrorCode: syncError.code,
      driftReport: { class: syncError.code === "SCHEMA_DRIFT" ? "BREAKING" : "ERROR", fields: [], notes: [] }
    }, { exchangeId, pause });
    if (syncError.action === "RETRY") throw syncError;
    return withJobLease(lease, async () => {});
  }
}

async function finishBinanceLoad(lease: JobLease, load: RawLoad) {
  return withJobLease(lease, async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(load)}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092029, hashtext(${load.runId!}))`;
    const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: load.id } });
    if (current.state === "SUPERSEDED" || current.state === "TRANSFORMED") return;
    // This phase only finalizes minimized GET intake. No UID metrics or ledger writes.
    await tx.rawLoad.update({ where: { id: load.id }, data: { state: "TRANSFORMED", transformedAt: new Date() } });
    const run = await tx.syncRun.findUniqueOrThrow({ where: { id: load.runId! } });
    const completed = await tx.rawLoad.aggregate({ where: { runId: run.id, state: "TRANSFORMED" }, _count: true, _sum: { rowCount: true } });
    const expected = Number((run.checkpoint as { expectedDays?: number } | null)?.expectedDays ?? 0);
    const finished = completed._count === expected && run.state === "RUNNING";
    const loads = await tx.rawLoad.findMany({ where: { runId: run.id, state: "TRANSFORMED" }, select: { periodStart: true } });
    await tx.syncRun.update({ where: { id: run.id }, data: {
      checkpoint: { expectedDays: expected, fetchedRows: completed._sum.rowCount ?? 0, mode: "GET_ONLY" },
      daysWritten: loads.map(item => dayStamp(item.periodStart)),
      driftReport: { class: "SAME", fields: [], notes: ["GET-only raw intake; no verified UID activity or wallet attribution"] },
      ...(finished ? { state: "SUCCEEDED", finishedAt: new Date() } : {})
    } });
    if (finished) await tx.exchangeSyncConfig.updateMany({ where: { exchangeId: load.exchangeId, rootAccount: load.rootAccount },
      data: { consecutiveFailures: 0, lastSuccessAt: new Date() } });
  });
}

export async function transformApiJob(lease: JobLease, loadId: string) {
  const load = await db.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
  if (load.state === "SUPERSEDED" || load.state === "TRANSFORMED") return withJobLease(lease, async () => {});
  if (!load.runId) throw new Error("API transform has no sync run");
  if (load.sourceSystem === "binance") return finishBinanceLoad(lease, load);
  const meta = (load.sourceMetadata ?? {}) as Record<string, string>;
  const contract = load.sourceSystem === "mexc" ? mexcAffiliateContract : bybitAffiliateContract;
  try {
    const accepted = await db.activityPeriodStatus.findFirst({ where: { exchangeId: load.exchangeId, rootAccount: load.rootAccount, schemaFingerprint: { not: null } },
      orderBy: { lastCheckedAt: "desc" }, select: { schemaFingerprint: true } });
    if (load.sourceSystem !== "bybit" && load.sourceSystem !== "mexc") throw new SyncError("UNSUPPORTED", "QUARANTINE", "Unknown API source");
    const records = await readRawRows(loadId);
    const mapped = load.sourceSystem === "mexc"
      ? mapMexcRecords(records, accepted?.schemaFingerprint)
      : mapAffiliateRecords(records, accepted?.schemaFingerprint);
    if (mapped.duplicate) throw new SyncError("DUPLICATE_UID", "QUARANTINE", "Affiliate API returned a duplicate UID");
    await withJobLease(lease, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(load)}))`;
      const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
      if (current.state === "SUPERSEDED") return;
      const day = meta.day;
      if (!day || !meta.observedAt) throw new Error("MISSING_DAY_METADATA");
      await lockActivityPeriod(tx, `${load.exchangeId}|${load.rootAccount}|${day}`);
      const result = await publishApiDay(tx, { exchangeId: load.exchangeId, rootAccount: load.rootAccount, periodDate: day,
        runId: load.runId!, metrics: mapped.metrics, state: meta.dayState as ActivityDayState, fingerprint: mapped.fingerprint,
        observedAt: new Date(meta.observedAt), sourceAsOf: null, updateRoster: meta.updateRoster === "true",
        preserveReportedZero: load.sourceSystem === "mexc", ageMissingRoster: load.sourceSystem !== "mexc",
        contractVersion: contract.version, ...(load.sourceSystem === "mexc" ? { updateRoster: true } : {}) });
      await tx.rawLoad.update({ where: { id: loadId }, data: { state: "TRANSFORMED", transformedAt: new Date(), driftReport: { class: mapped.drift.class, fields: mapped.drift.fields } } });
      const run = await tx.syncRun.findUniqueOrThrow({ where: { id: load.runId! } });
      const days = Array.isArray(run.daysWritten) ? run.daysWritten.filter((value): value is string => typeof value === "string") : [];
      if (!result.unchanged) days.push(day);
      const completed = await tx.rawLoad.count({ where: { runId: run.id, state: "TRANSFORMED" } });
      const expected = Number((run.checkpoint as { expectedDays?: number } | null)?.expectedDays ?? 0);
      const previousDrift = (run.driftReport ?? {}) as { class?: string; fields?: string[]; notes?: string[] };
      const driftClass = mapped.drift.class !== "SAME" ? mapped.drift.class : previousDrift.class ?? "SAME";
      const driftFields = [...new Set([...(previousDrift.fields ?? []), ...mapped.drift.fields])];
      const notes = previousDrift.notes ?? (load.sourceSystem === "bybit" && !process.env.BYBIT_VOL_TIMEZONE
        ? ["volUpdateTime timezone is unconfirmed; sourceAsOf stays empty"]
        : load.sourceSystem === "mexc" ? ["MEXC day-filter aggregation needs portal reconciliation; reported activity only"] : []);
      await tx.syncRun.update({ where: { id: run.id }, data: { changedRows: { increment: result.changed }, daysWritten: days,
        driftReport: { class: driftClass, fields: driftFields, notes },
        ...(completed === expected && run.state === "RUNNING" ? { state: "SUCCEEDED", finishedAt: new Date() } : {}) } });
      if (completed === expected && run.state === "RUNNING") {
        const config = await tx.exchangeSyncConfig.findUnique({ where: { exchangeId: load.exchangeId } });
        if (config) await tx.exchangeSyncConfig.update({ where: { exchangeId: load.exchangeId }, data: { consecutiveFailures: 0, lastSuccessAt: new Date(),
          lastFetchedPeriodEnd: !config.lastFetchedPeriodEnd || load.periodStart > config.lastFetchedPeriodEnd ? load.periodStart : config.lastFetchedPeriodEnd } });
      }
    });
  } catch (error) {
    const syncError = error instanceof SyncError ? error : new SyncError("SCHEMA_DRIFT", "QUARANTINE", "Transform failed");
    return withJobLease(lease, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(load)}))`;
      const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
      if (current.state === "SUPERSEDED") return;
      await tx.rawLoad.update({ where: { id: loadId }, data: { state: "FAILED", safeErrorCode: syncError.code,
        driftReport: { class: "BREAKING", fields: syncError.code === "SCHEMA_DRIFT" ? (error instanceof Error ? error.message.split(": ").at(-1)?.split(", ") ?? [] : []) : [] } } });
      await tx.syncRun.update({ where: { id: load.runId! }, data: { state: "QUARANTINED", safeErrorCode: syncError.code, finishedAt: new Date() } });
      await tx.exchangeSyncConfig.update({ where: { exchangeId: load.exchangeId }, data: { pausedReason: syncError.code } });
    });
  }
}

export async function getSyncConfig(exchangeId: string) {
  const exchange = await db.exchange.findUnique({ where: { id: exchangeId }, select: { slug: true } });
  const [config, runs, coverage] = await Promise.all([
    db.exchangeSyncConfig.findUnique({ where: { exchangeId } }),
    db.syncRun.findMany({ where: { exchangeId }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.activityPeriodStatus.aggregate({ where: { exchangeId }, _min: { periodDate: true }, _max: { periodDate: true }, _count: true })
  ]);
  const failedLoads = await db.rawLoad.findMany({ where: { runId: { in: runs.map((run) => run.id) }, state: "FAILED" }, select: { id: true, runId: true, fieldNames: true, driftReport: true } });
  const binanceLoads = exchange?.slug === "binance" ? await db.rawLoad.findMany({ where: { exchangeId, rootAccount: config?.rootAccount, sourceSystem: "binance", state: "TRANSFORMED" }, select: { periodStart: true, rowCount: true, runId: true } }) : [];
  const rawDays = [...new Set(binanceLoads.map(load => dayStamp(load.periodStart)))].sort();
  const readiness = recentReadiness(config);
  return {
    exchangeId,
    configured: config?.credentialsConfigured ?? false,
    readiness: {
      ...readiness,
      expiresAt: config?.readinessExpiresAt?.toISOString() ?? null,
      ipWarning: config?.readinessIpWarning ?? false
    },
    rootAccount: config?.rootAccount ?? null,
    enabled: config?.enabled ?? false,
    intervalMinutes: config?.intervalMinutes ?? 30,
    nextRunAt: config?.nextRunAt?.toISOString() ?? null,
    lastAttemptAt: config?.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: config?.lastSuccessAt?.toISOString() ?? null,
    pausedReason: config?.pausedReason ?? null,
    consecutiveFailures: config?.consecutiveFailures ?? 0,
    coverage: exchange?.slug === "binance" ? { from: rawDays[0] ?? null, to: rawDays.at(-1) ?? null, days: rawDays.length } : { from: coverage._min.periodDate ? dayStamp(coverage._min.periodDate) : null, to: coverage._max.periodDate ? dayStamp(coverage._max.periodDate) : null, days: coverage._count },
    runs: runs.map((run) => ({
      id: run.id, trigger: run.trigger, state: run.state, changedRows: run.changedRows, safeErrorCode: run.safeErrorCode,
      fetchedRows: exchange?.slug === "binance" ? Number((run.checkpoint as { fetchedRows?: number } | null)?.fetchedRows ?? 0) : null,
      createdAt: run.createdAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, driftReport: run.driftReport,
      failedLoads: failedLoads.filter((load) => load.runId === run.id).map((load) => ({ id: load.id, fieldNames: load.fieldNames, driftReport: load.driftReport }))
    })),
    note: exchange?.slug === "binance" ? "Binance GET-only: fetches Spot and USD-M Futures data. Empty responses are valid. Fetched rows stay in raw storage; UID mapping and activity publishing are not enabled." : "API commission is reported activity, not payable cashback; portal reconciliation is required before wallet attribution."
  };
}

export async function updateSyncConfig(adminId: string, exchangeId: string, patch: { enabled?: boolean; intervalMinutes?: SyncInterval }) {
  if (patch.intervalMinutes && !INTERVALS.includes(patch.intervalMinutes)) throw new SyncError("INTERVAL", "QUARANTINE", "Interval must be 30, 60, 720, or 1440 minutes");
  const exchange = await db.exchange.findUnique({ where: { id: exchangeId } });
  if (!exchange) throw new SyncError("UNSUPPORTED", "QUARANTINE", "Exchange does not exist");
  const current = await db.exchangeSyncConfig.findUnique({ where: { exchangeId } });
  const supported = ACTIVITY_API_EXCHANGES.includes(exchange.slug);
  const enabled = patch.enabled ?? current?.enabled ?? false;
  if (enabled && !supported) throw new SyncError("UNSUPPORTED", "QUARANTINE", "Exchange has no activity connector");
  const enabling = patch.enabled === true && !current?.enabled;
  if (enabling) requireRecentReadiness(current);
  const intervalMinutes = patch.intervalMinutes ?? current?.intervalMinutes ?? 30;
  const data = {
    rootAccount: current?.rootAccount ?? "unconfigured",
    enabled,
    intervalMinutes,
    // Enabling queues an immediate run below, so the first scheduled slot is one interval later.
    nextRunAt: !enabled ? null : enabling || !current?.nextRunAt || intervalMinutes !== current.intervalMinutes
      ? new Date(Date.now() + intervalMinutes * 60_000)
      : current.nextRunAt,
    pausedReason: enabling ? null : current?.pausedReason,
    updatedBy: adminId
  };
  const saved = await db.exchangeSyncConfig.upsert({
    where: { exchangeId },
    create: { exchangeId, ...data, consecutiveFailures: 0 },
    update: data
  });
  await db.syncConfigAudit.create({ data: { exchangeId, adminId, action: "UPDATE_CONFIG", before: current ?? undefined, after: saved } });
  if (enabling) {
    const today = dayStamp(new Date());
    await enqueue(exchangeId, saved.rootAccount, "MANUAL", openWindow(today));
    for (let offset = 1; offset <= saved.backfillDays; offset += 1) {
      const periodDate = addDays(today, -offset);
      const covered = await db.activityPeriodStatus.findUnique({
        where: { exchangeId_rootAccount_periodDate: { exchangeId, rootAccount: saved.rootAccount, periodDate: new Date(`${periodDate}T00:00:00.000Z`) } }
      });
      if (covered) continue;
      await db.job.create({ data: { type: "SYNC", runAfter: new Date(Date.now() + offset * 60_000), payload: { exchangeId, trigger: "BACKFILL", dates: [periodDate] } } });
    }
  }
  return getSyncConfig(exchangeId);
}

export async function requestSync(adminId: string, exchangeId: string, trigger: SyncTrigger, dates: string[]) {
  const config = await db.exchangeSyncConfig.findUnique({ where: { exchangeId } });
  requireRecentReadiness(config);
  if (config.pausedReason && trigger !== "RESYNC") throw new SyncError(config.pausedReason, "PAUSE", "Connector is paused");
  if (!dates.length || dates.length > 366) throw new SyncError("RANGE", "QUARANTINE", "Choose between 1 and 366 days");
  const exchange = await db.exchange.findUnique({ where: { id: exchangeId }, select: { slug: true } });
  if (exchange?.slug === "binance") validateBinanceDates(dates);
  if (!await enqueue(exchangeId, config.rootAccount, trigger, dates)) throw new SyncError("ACTIVE_RUN", "RETRY", "A sync is already queued or running");
  await db.syncConfigAudit.create({ data: { exchangeId, adminId, action: trigger === "RESYNC" ? "RESYNC_RANGE" : "RUN_NOW", after: { dates } } });
  return { accepted: true };
}

export async function resumeSync(adminId: string, exchangeId: string) {
  const config = await db.exchangeSyncConfig.findUnique({ where: { exchangeId } });
  requireRecentReadiness(config);
  await db.exchangeSyncConfig.update({ where: { exchangeId }, data: { pausedReason: null, consecutiveFailures: 0, updatedBy: adminId } });
  await db.syncConfigAudit.create({ data: { exchangeId, adminId, action: "RESUME" } });
  return getSyncConfig(exchangeId);
}

export async function releaseOverride(adminId: string, exchangeId: string, rootAccount: string, periodStart: string, periodEnd: string) {
  await db.activityPeriodOverride.updateMany({
    where: { exchangeId, rootAccount, periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), active: true },
    data: { active: false, updatedBy: adminId }
  });
  await db.syncConfigAudit.create({ data: { exchangeId, adminId, action: "RELEASE_OVERRIDE", after: { rootAccount, periodStart, periodEnd } } });
}

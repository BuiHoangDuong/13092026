import { Prisma } from "@cashback/db";
import { bybitAffiliateContract, canonicalizeRecord, classifyHeaders, schemaFingerprint, signBybit, type DriftReport, type MetricDraft } from "./contract.js";

const AMOUNT = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/;
const ASSET = /^[A-Z0-9]{1,16}$/;
const UID = /^\d{1,128}$/;
const VOLUME_FIELDS = [
  ["TRADE_VOLUME", "tradeVol"],
  ["TAKER_VOLUME", "takerVol"],
  ["MAKER_VOLUME", "makerVol"],
  ["TRADFI_VOLUME", "tradfiTradeVol"]
] as const;

export class SyncError extends Error {
  constructor(public readonly code: string, public readonly action: "RETRY" | "PAUSE" | "QUARANTINE", message: string) { super(message); }
}

export function classifyBybitError(retCode: number) {
  if (retCode === 10006 || retCode === 429) return new SyncError(String(retCode), "RETRY", "Bybit rate limit");
  if (retCode === 610015) return new SyncError("610015", "QUARANTINE", "Bybit rejected the request parameters");
  if ([10003, 10004, 10005, 10010, 33004].includes(retCode)) return new SyncError(String(retCode), "PAUSE", "Bybit refused the API key");
  if (retCode >= 500) return new SyncError(String(retCode), "RETRY", "Bybit temporary error");
  return new SyncError(String(retCode), "QUARANTINE", "Bybit request failed");
}

export type AffiliateRecord = Record<string, unknown>;
export type MappedDay = { metrics: MetricDraft[]; warnings: string[]; drift: DriftReport; fingerprint: string; duplicate: boolean };

function decimalOrEmpty(value: unknown, label: string): { state: "VALUE" | "EMPTY"; amount: string | null } {
  if (value == null || value === "") return { state: "EMPTY", amount: null };
  if (typeof value !== "string" || !AMOUNT.test(value)) throw new SyncError("BREAKING", "QUARANTINE", `Unparseable ${label}`);
  return { state: "VALUE", amount: new Prisma.Decimal(value).toFixed(10) };
}

export function mapAffiliateRecords(records: AffiliateRecord[], previousFingerprint?: string | null): MappedDay {
  if (!records.length) {
    const fingerprint = schemaFingerprint([], bybitAffiliateContract);
    return { metrics: [], warnings: [], drift: { class: "SAME", fields: [], fingerprint, contractVersion: bybitAffiliateContract.version }, fingerprint, duplicate: false };
  }
  const names = new Set<string>();
  for (const record of records) for (const key of Object.keys(record)) names.add(key);
  const assetKeys = new Set<string>();
  for (const record of records) {
    const map = record.commissionsVol;
    if (map && typeof map === "object" && !Array.isArray(map)) for (const key of Object.keys(map)) assetKeys.add(key);
  }
  const headerDrift = classifyHeaders([...names], bybitAffiliateContract, null);
  const fingerprint = schemaFingerprint([...names, ...[...assetKeys].map((key) => `commissionsVol.${key}`)], bybitAffiliateContract);
  const assetDrift = Boolean(previousFingerprint && previousFingerprint !== fingerprint && headerDrift.class === "SAME");
  const drift: DriftReport = {
    class: headerDrift.class === "BREAKING" ? "BREAKING" : assetDrift ? "ADDITIVE" : headerDrift.class,
    fields: assetDrift ? [...headerDrift.fields, ...[...assetKeys].sort()] : headerDrift.fields,
    fingerprint, contractVersion: bybitAffiliateContract.version
  };
  if (records.length && drift.class === "BREAKING") throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", `Missing required field: ${drift.fields.join(", ")}`);
  const warnings = drift.class === "SAME" ? [] : drift.fields.map((field) => field.includes("->") ? `Alias: ${field}` : `Extra column: ${field}`);
  const seen = new Set<string>();
  let duplicate = false;
  const metrics: MetricDraft[] = [];
  for (const sourceRecord of records) {
    const record = canonicalizeRecord(sourceRecord, bybitAffiliateContract);
    const rawUid = record.userId;
    if (typeof rawUid !== "string" || !UID.test(rawUid)) throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", "UID is not text");
    if (seen.has(rawUid)) duplicate = true;
    seen.add(rawUid);
    const referralCode = typeof record.source === "string" && record.source.trim() ? record.source.trim().slice(0, 64) : null;
    for (const [kind, source] of VOLUME_FIELDS) {
      const parsed = decimalOrEmpty(record[source], source);
      metrics.push({ uid: rawUid, referralCode, kind, asset: "USDT", valueState: parsed.state, amount: parsed.amount });
    }
    const commissions = record.commissionsVol;
    if (!commissions || typeof commissions !== "object" || Array.isArray(commissions)) throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", "commissionsVol is not an object");
    for (const [asset, value] of Object.entries(commissions)) {
      if (!ASSET.test(asset)) throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", "Unsupported commission asset");
      const parsed = decimalOrEmpty(value, asset);
      metrics.push({ uid: rawUid, referralCode, kind: "REPORTED_COMMISSION", asset, valueState: parsed.state, amount: parsed.amount });
    }
  }
  return { metrics, warnings, drift, fingerprint, duplicate };
}

export function canonicalQuery(params: Record<string, string | undefined>) {
  return Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("&");
}

export type BybitResponse = { retCode?: number; retMsg?: string; time?: number; result?: { list?: AffiliateRecord[]; nextPageCursor?: string } };

export async function fetchAffiliateDay(input: {
  day: string;
  apiKey: string;
  apiSecret: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  reserve?: () => Promise<void>;
  onPage?: () => Promise<void>;
}) {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = (input.baseUrl ?? "https://api.bybit.com").replace(/\/$/, "");
  const records: AffiliateRecord[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let observedAt = new Date();
  for (;;) {
    if (input.reserve) await input.reserve();
    if (input.onPage) await input.onPage();
    const query = canonicalQuery({ startDate: input.day, endDate: input.day, size: "100", cursor });
    const timestamp = Date.now().toString();
    const response = await fetchImpl(`${base}/v5/affiliate/aff-user-list?${query}`, {
      headers: {
        "X-BAPI-API-KEY": input.apiKey,
        "X-BAPI-TIMESTAMP": timestamp,
        "X-BAPI-RECV-WINDOW": "5000",
        "X-BAPI-SIGN": signBybit(input.apiSecret, timestamp, input.apiKey, "5000", query)
      }
    });
    if (response.status === 429) throw new SyncError("429", "RETRY", "Bybit rate limit");
    if (response.status >= 500) throw new SyncError(String(response.status), "RETRY", "Bybit temporary error");
    // An IP-allowlist or WAF rejection arrives as HTTP 401/403, often with a non-JSON body.
    if (response.status === 401 || response.status === 403) throw new SyncError(`HTTP_${response.status}`, "PAUSE", "Bybit refused the request (key or IP allowlist)");
    let body: BybitResponse;
    try { body = await response.json() as BybitResponse; }
    catch { throw new SyncError("NON_JSON", "RETRY", "Bybit returned a non-JSON response"); }
    if (body.retCode !== 0) throw classifyBybitError(body.retCode ?? response.status);
    if (typeof body.time === "number") observedAt = new Date(body.time);
    const list = body.result?.list ?? [];
    // Bybit echoes the requested dates on every row, not on `result`.
    for (const row of list) {
      if ((row.startDate !== undefined && row.startDate !== input.day) || (row.endDate !== undefined && row.endDate !== input.day)) {
        throw new SyncError("DATE_ECHO", "QUARANTINE", "Bybit echoed a different period");
      }
    }
    records.push(...list);
    const next = body.result?.nextPageCursor ?? "";
    if (!list.length || !next) break;
    if (cursors.has(next)) throw new SyncError("REPEATED_CURSOR", "QUARANTINE", "Bybit repeated a page cursor");
    cursors.add(next);
    cursor = next;
  }
  return { records, observedAt };
}

export type Readiness = { ready: boolean; reason: string | null; expiresAt: string | null; expiryWarning: boolean; ipWarning: boolean };

export function assessQueryApi(result: { readOnly?: number; permissions?: Record<string, string[]>; ips?: string[]; expiredAt?: string } | null, now = new Date()): Readiness {
  if (!result) return { ready: false, reason: "MISSING_KEY", expiresAt: null, expiryWarning: false, ipWarning: false };
  const permissions = result.permissions ?? {};
  const granted = Object.entries(permissions).filter(([, values]) => Array.isArray(values) && values.length > 0).map(([key]) => key);
  const affiliateOnly = result.readOnly === 1 && granted.length === 1 && granted[0] === "Affiliate";
  const expiresAt = result.expiredAt ?? null;
  const expiry = expiresAt ? new Date(expiresAt) : null;
  const expired = Boolean(expiry && expiry.getTime() <= now.getTime());
  const expiryWarning = Boolean(expiry && expiry.getTime() - now.getTime() < 14 * 24 * 60 * 60 * 1000 && !expired);
  const ipWarning = (result.ips ?? []).includes("*");
  if (!affiliateOnly) return { ready: false, reason: "PERMISSION", expiresAt, expiryWarning, ipWarning };
  if (expired) return { ready: false, reason: "EXPIRED", expiresAt, expiryWarning, ipWarning };
  return { ready: true, reason: null, expiresAt, expiryWarning, ipWarning };
}

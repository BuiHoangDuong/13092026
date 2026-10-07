import { createHmac } from "node:crypto";
import { Prisma } from "@cashback/db";
import { canonicalizeRecord, classifyHeaders, mexcAffiliateContract, type DriftReport, type MetricDraft } from "./contract.js";
import { SyncError } from "./bybit-affiliate.js";

const UID = /^\d{1,128}$/;
const AMOUNT = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/;
const PAGE_SIZE = 100;
const MAX_PAGES = 500;

export type MexcReferralRecord = Record<string, unknown>;
const STORED_FIELDS = new Set(["uid", "inviteCode", "tradingAmount", "commission", "amount"]);

export function minimizeMexcRecords(records: MexcReferralRecord[]) {
  return records.map((record) => Object.fromEntries(Object.entries(record).filter(([key]) => STORED_FIELDS.has(key))));
}

type MexcEnvelope = { success?: boolean; code?: number; message?: string; data?: {
  currentPage?: number; totalPage?: number; totalCount?: number; resultList?: MexcReferralRecord[]
} };

export function signMexc(secret: string, query: string) {
  return createHmac("sha256", secret).update(query).digest("hex");
}

function classifyResponse(status: number, code?: number): SyncError {
  if (status === 401 || status === 403 || [400, 401, 403, 602, 10072, 700001, 700002, 700003, 700006, 700007].includes(code ?? -1))
    return new SyncError(`MEXC_${code ?? status}`, "PAUSE", "MEXC refused the affiliate key or signature");
  if (status === 429 || status >= 500 || code === 429)
    return new SyncError(`MEXC_${code ?? status}`, "RETRY", "MEXC affiliate API is temporarily unavailable");
  return new SyncError(`MEXC_${code ?? status}`, "QUARANTINE", "MEXC affiliate request failed");
}

export async function fetchMexcPage(input: {
  startTime: number; endTime: number; page: number; apiKey: string; apiSecret: string;
  baseUrl?: string; fetchImpl?: typeof fetch;
}) {
  const params = new URLSearchParams({
    startTime: String(input.startTime), endTime: String(input.endTime), page: String(input.page),
    pageSize: String(PAGE_SIZE), recvWindow: "10000", timestamp: String(Date.now())
  });
  const query = params.toString();
  params.set("signature", signMexc(input.apiSecret, query));
  const response = await (input.fetchImpl ?? fetch)(`${(input.baseUrl ?? "https://api.mexc.com").replace(/\/$/, "")}/api/v3/rebate/affiliate/referral?${params}`, {
    headers: { "X-MEXC-APIKEY": input.apiKey }, signal: AbortSignal.timeout(10_000)
  });
  if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500)
    throw classifyResponse(response.status);
  let body: MexcEnvelope;
  try { body = await response.json() as MexcEnvelope; }
  catch { throw new SyncError("NON_JSON", "RETRY", "MEXC returned a non-JSON response"); }
  if (body.success !== true || body.code !== 0) throw classifyResponse(response.status, body.code);
  const data = body.data;
  if (!data || !Array.isArray(data.resultList) || !Number.isSafeInteger(data.currentPage) ||
      typeof data.totalPage !== "number" || !Number.isSafeInteger(data.totalPage) || data.currentPage !== input.page ||
      data.totalPage < 0 || data.totalPage > MAX_PAGES ||
      typeof data.totalCount !== "number" || !Number.isSafeInteger(data.totalCount) || data.totalCount < 0 ||
      data.resultList.length > PAGE_SIZE)
    throw new SyncError("MALFORMED_PAGE", "QUARANTINE", "MEXC returned an incomplete affiliate page");
  return data;
}

export async function fetchMexcDay(input: {
  day: string; apiKey: string; apiSecret: string; baseUrl?: string;
  fetchImpl?: typeof fetch; reserve?: () => Promise<void>; onPage?: () => Promise<void>;
}) {
  const startTime = Date.parse(`${input.day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !Number.isFinite(startTime) || new Date(startTime).toISOString().slice(0, 10) !== input.day)
    throw new SyncError("INVALID_DAY", "QUARANTINE", "Invalid UTC day");
  const endTime = startTime + 86_400_000 - 1;
  const records: MexcReferralRecord[] = [];
  let totalPages: number | null = null;
  let totalCount: number | null = null;
  for (let page = 1; page <= (totalPages ?? 1); page += 1) {
    await input.reserve?.();
    await input.onPage?.();
    const result = await fetchMexcPage({ ...input, startTime, endTime, page });
    if (totalPages === null) { totalPages = result.totalPage!; totalCount = result.totalCount!; }
    if (result.totalPage !== totalPages || result.totalCount !== totalCount ||
        (page < totalPages && result.resultList!.length === 0))
      throw new SyncError("INCOMPLETE_PAGINATION", "QUARANTINE", "MEXC affiliate pages changed during the fetch");
    records.push(...result.resultList!);
  }
  if (records.length !== totalCount) throw new SyncError("INCOMPLETE_PAGINATION", "QUARANTINE", "MEXC affiliate row count does not match its pages");
  return { records, observedAt: new Date() };
}

export function mapMexcRecords(records: MexcReferralRecord[], previousFingerprint?: string | null) {
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const drift = classifyHeaders(names, mexcAffiliateContract, previousFingerprint);
  if (records.length && drift.class === "BREAKING")
    throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", `Missing required field: ${drift.fields.join(", ")}`);
  const seen = new Set<string>();
  let duplicate = false;
  const metrics: MetricDraft[] = [];
  for (const source of records) {
    const record = canonicalizeRecord(source, mexcAffiliateContract);
    const rawUid = record.uid;
    const uid = typeof rawUid === "string" ? rawUid : typeof rawUid === "number" && Number.isSafeInteger(rawUid) ? String(rawUid) : "";
    if (!UID.test(uid)) throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", "MEXC UID is invalid");
    if (seen.has(uid)) duplicate = true;
    seen.add(uid);
    const referralCode = typeof record.inviteCode === "string" ? record.inviteCode.slice(0, 64) : null;
    for (const [kind, key] of [["TRADE_VOLUME", "tradingAmount"], ["REPORTED_COMMISSION", "commission"]] as const) {
      const value = record[key];
      if (typeof value !== "string" || !AMOUNT.test(value))
        throw new SyncError("SCHEMA_DRIFT", "QUARANTINE", `Invalid MEXC ${key}`);
      metrics.push({ uid, referralCode, kind, asset: "USDT", valueState: "VALUE", amount: new Prisma.Decimal(value).toFixed(10) });
    }
  }
  return { metrics, warnings: drift.fields, drift: drift as DriftReport, fingerprint: drift.fingerprint, duplicate };
}

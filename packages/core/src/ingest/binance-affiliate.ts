import { createHash, createHmac } from "node:crypto";
import { SyncError, type Readiness } from "./bybit-affiliate.js";
import type { FieldContract } from "./contract.js";

export const binanceAffiliateContract: FieldContract = {
  version: "binance-get-only@1", fields: [], personal: ["email"],
  ignored: ["customerId", "income", "asset", "symbol", "time", "orderId", "tradeId", "unit", "tradeVol", "rebateVol", "product"]
};
export function binanceCredentials() {
  const apiKey = process.env.BINANCE_AFFILIATE_API_KEY?.trim() ?? "";
  const apiSecret = process.env.BINANCE_AFFILIATE_API_SECRET?.trim() ?? "";
  // Key scope is deliberately not represented as a verified Binance account UID.
  const rootAccount = apiKey ? `binance-key:${createHash("sha256").update(apiKey).digest("hex").slice(0, 24)}` : "";
  return { apiKey, apiSecret, rootAccount, configured: Boolean(apiKey && apiSecret) };
}
type ClientInput = {
  apiKey: string; apiSecret: string; fetchImpl?: typeof fetch;
  reserve?: () => Promise<void>; onThrottle?: (milliseconds: number) => Promise<void>;
};
const ENDPOINTS = [
  { base: "https://api.binance.com", clock: "/api/v3/time", path: "/sapi/v1/apiReferral/rebate/recentRecord", product: "SPOT", limit: 500 },
  { base: "https://fapi.binance.com", clock: "/fapi/v1/time", path: "/fapi/v1/apiReferral/traderSummary", product: "USD_M_FUTURES", limit: 1000 }
] as const;

async function request(input: ClientInput, url: string, signed = false) {
  await input.reserve?.();
  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: "GET", headers: signed ? { "X-MBX-APIKEY": input.apiKey } : {},
      redirect: "error", signal: AbortSignal.timeout(10_000)
    });
  } catch { throw new SyncError("BINANCE_NETWORK", "RETRY", "Binance GET is temporarily unavailable"); }
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    await input.onThrottle?.((Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000);
    throw new SyncError("BINANCE_429", "RETRY", "Binance rate limit");
  }
  if (response.status === 418) {
    const seconds = Number(response.headers.get("Retry-After"));
    await input.onThrottle?.((Number.isFinite(seconds) && seconds > 0 ? seconds : 3 * 86400) * 1000);
    throw new SyncError("BINANCE_418", "PAUSE", "Binance IP is banned");
  }
  if ([401, 403].includes(response.status)) throw new SyncError(`BINANCE_${response.status}`, "PAUSE", "Binance refused the key, IP or request");
  if (response.status >= 500) throw new SyncError(`BINANCE_${response.status}`, "RETRY", "Binance temporary error");
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new SyncError("BINANCE_NON_JSON", "RETRY", "Binance returned a non-JSON response"); }
  const code = body && typeof body === "object" && "code" in body ? (body as { code: unknown }).code : null;
  if (!response.ok || (typeof code === "number" && code < 0)) {
    const action = [-2014, -2015, -1022].includes(Number(code)) ? "PAUSE" : code === -1021 ? "RETRY" : "QUARANTINE";
    throw new SyncError(`BINANCE_${typeof code === "number" ? code : response.status}`, action, "Binance GET request failed");
  }
  return body;
}

async function signedGet(input: ClientInput, base: string, clock: string, path: string, values: Record<string, string>) {
  const time = await request(input, `${base}${clock}`) as { serverTime?: number };
  if (!Number.isSafeInteger(time?.serverTime)) throw new SyncError("BINANCE_CLOCK", "RETRY", "Binance server clock is unavailable");
  const params = new URLSearchParams({ ...values, recvWindow: "5000", timestamp: String(time.serverTime) });
  params.set("signature", createHmac("sha256", input.apiSecret).update(params.toString()).digest("hex"));
  return request(input, `${base}${path}?${params}`, true);
}

export async function checkBinanceKey(input: ClientInput): Promise<Readiness> {
  const result = await signedGet(input, "https://api.binance.com", "/api/v3/time", "/sapi/v1/account/apiRestrictions", {}) as Record<string, unknown>;
  if (!result || typeof result.enableReading !== "boolean" || typeof result.ipRestrict !== "boolean")
    throw new SyncError("BINANCE_PERMISSIONS_SHAPE", "QUARANTINE", "Binance permissions response is incomplete");
  const unsafe = ["enableSpotAndMarginTrading", "enableFutures", "enableWithdrawals", "enableInternalTransfer", "permitsUniversalTransfer", "enableMargin", "enableVanillaOptions"];
  return { ready: result.enableReading === true && !unsafe.some(key => result[key] === true),
    reason: result.enableReading !== true || unsafe.some(key => result[key] === true) ? "BINANCE_READ_ONLY_REQUIRED" : null,
    expiresAt: null, expiryWarning: false, ipWarning: result.ipRestrict === false };
}

export function minimizeBinanceRecords(records: Record<string, unknown>[], product: string) {
  const fields = binanceAffiliateContract.ignored.filter(key => key !== "product");
  return records.map(row => Object.fromEntries([
    ...Object.entries(row).filter(([key, value]) => fields.includes(key) &&
      (typeof value === "string" || typeof value === "number") &&
      !(key === "customerId" && typeof value === "string" && value.includes("@"))),
    ["product", product]
  ]));
}

export async function fetchBinanceDay(input: ClientInput & { day: string }) {
  const start = Date.parse(`${input.day}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day) || !Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== input.day)
    throw new SyncError("INVALID_DAY", "QUARANTINE", "Invalid UTC day");
  const records: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  for (const endpoint of ENDPOINTS) {
    const body = await signedGet(input, endpoint.base, endpoint.clock, endpoint.path, {
      startTime: String(start), endTime: String(start + 86_400_000 - 1), limit: String(endpoint.limit),
      ...(endpoint.product === "USD_M_FUTURES" ? { type: "1" } : {})
    });
    if (!Array.isArray(body) || body.some(row => !row || typeof row !== "object" || Array.isArray(row)))
      throw new SyncError("BINANCE_SCHEMA", "QUARANTINE", "Binance returned an invalid record list");
    if (body.length >= endpoint.limit) throw new SyncError("BINANCE_LIMIT_REACHED", "QUARANTINE", "Binance GET may be truncated; no partial day was loaded");
    counts[endpoint.product] = body.length;
    records.push(...minimizeBinanceRecords(body, endpoint.product));
  }
  return { records, counts, observedAt: new Date() };
}

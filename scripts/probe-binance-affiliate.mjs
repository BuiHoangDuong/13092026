import { createHmac } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true, override: true });
const apiKey = process.env.BINANCE_AFFILIATE_API_KEY?.trim();
const apiSecret = process.env.BINANCE_AFFILIATE_API_SECRET?.trim();
const days = Number(process.argv.find((arg) => arg.startsWith("--days="))?.split("=")[1] ?? "1");
if (!Number.isInteger(days) || days < 1 || days > 7) throw new Error("Choose --days=1 through --days=7");
const report = (value) => console.log(JSON.stringify(value));
const allowedFields = ["customerId", "income", "asset", "symbol", "time", "orderId", "tradeId", "unit", "tradeVol", "rebateVol"];
let stopped = false;

async function probe(base, endpoint, params, permissionCheck = false) {
  if (stopped) return;
  try {
    // Use the exchange clock so local clock drift does not masquerade as bad credentials.
    const timeResponse = await fetch(`${base}${base.includes("fapi") ? "/fapi/v1/time" : "/api/v3/time"}`, {
      signal: AbortSignal.timeout(10_000), redirect: "error"
    });
    if (!timeResponse.ok) {
      report({ endpoint, connected: false, stage: "SERVER_TIME", httpStatus: timeResponse.status });
      if ([418, 429].includes(timeResponse.status)) stopped = true;
      process.exitCode = 1;
      return;
    }
    const time = await timeResponse.json();
    if (!Number.isSafeInteger(time.serverTime)) throw new Error("INVALID_SERVER_TIME");
    const endTime = time.serverTime;
    const query = new URLSearchParams({ ...(params ? params(endTime) : {}), recvWindow: "5000", timestamp: String(endTime) });
    query.set("signature", createHmac("sha256", apiSecret).update(query.toString()).digest("hex"));
    const response = await fetch(`${base}${endpoint}?${query}`, {
      method: "GET", headers: { "X-MBX-APIKEY": apiKey },
      signal: AbortSignal.timeout(10_000), redirect: "error"
    });
    const body = await response.json().catch(() => null);
    const code = typeof body?.code === "number" ? body.code : null;
    const connected = response.ok && (code === null || code === 0) &&
      (permissionCheck ? body !== null && typeof body === "object" && !Array.isArray(body) && typeof body.enableReading === "boolean" : Array.isArray(body));
    const result = { endpoint, connected, httpStatus: response.status, code };
    if (connected && permissionCheck) {
      result.permissions = Object.fromEntries(["ipRestrict", "enableReading", "enableSpotAndMarginTrading", "enableFutures", "enableWithdrawals", "enableInternalTransfer", "permitsUniversalTransfer", "enableMargin"].filter((key) => typeof body[key] === "boolean").map((key) => [key, body[key]]));
    } else if (connected) {
      result.rows = body.length;
      result.fields = allowedFields.filter((field) => body.some((row) => row && Object.hasOwn(row, field)));
      result.limitReached = body.length === 500;
    }
    report(result);
    if (!connected) process.exitCode = 1;
    // Do not continue requests after throttling or an IP ban. Never auto-retry.
    if ([418, 429].includes(response.status)) stopped = true;
  } catch (error) {
    report({ endpoint, connected: false, error: error instanceof Error ? error.name : "REQUEST_FAILED" });
    process.exitCode = 1;
  }
}

if (!apiKey || !apiSecret) {
  report({ configured: false, code: "MISSING_KEY", missing: [!apiKey && "BINANCE_AFFILIATE_API_KEY", !apiSecret && "BINANCE_AFFILIATE_API_SECRET"].filter(Boolean) });
  process.exitCode = 1;
} else {
  report({ configured: true, windowDays: days });
  await probe("https://api.binance.com", "/sapi/v1/account/apiRestrictions", null, true);
  const period = (now) => ({ startTime: String(now - days * 86_400_000), endTime: String(now), limit: "500" });
  await probe("https://api.binance.com", "/sapi/v1/apiReferral/rebate/recentRecord", period);
  await probe("https://fapi.binance.com", "/fapi/v1/apiReferral/traderSummary", (now) => ({ ...period(now), type: "1" }));
}

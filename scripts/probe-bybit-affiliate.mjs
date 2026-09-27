import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { signBybit, canonicalQuery } from "../packages/core/dist/index.js";

dotenv.config({ quiet: true });
const apiKey = process.env.BYBIT_AFFILIATE_API_KEY ?? "";
const apiSecret = process.env.BYBIT_AFFILIATE_API_SECRET ?? "";
if (!apiKey || !apiSecret) {
  console.log("SKIP: set BYBIT_AFFILIATE_API_KEY and BYBIT_AFFILIATE_API_SECRET to probe");
  process.exit(0);
}
const base = (process.env.BYBIT_API_BASE ?? "https://api.bybit.com").replace(/\/$/, "");
async function call(pathname, params) {
  const query = canonicalQuery(params);
  const timestamp = Date.now().toString();
  const response = await fetch(`${base}${pathname}?${query}`, { headers: {
    "X-BAPI-API-KEY": apiKey, "X-BAPI-TIMESTAMP": timestamp, "X-BAPI-RECV-WINDOW": "5000",
    "X-BAPI-SIGN": signBybit(apiSecret, timestamp, apiKey, "5000", query)
  } });
  const body = await response.json();
  return { status: response.status, retCode: body.retCode, keys: body.result ? Object.keys(body.result) : [], list: Array.isArray(body.result?.list) ? body.result.list.length : 0 };
}
const day = new Date().toISOString().slice(0, 10);
const readiness = await call("/v5/user/query-api", {});
const activity = await call("/v5/affiliate/aff-user-list", { startDate: day, endDate: day, size: "1" });
const directory = path.resolve("data/bybit");
mkdirSync(directory, { recursive: true });
writeFileSync(path.join(directory, "probe-summary.json"), JSON.stringify({ readiness, activity, day }, null, 2));
console.log(`readiness retCode=${readiness.retCode} activityRows=${activity.list} raw summary written under data/bybit`);

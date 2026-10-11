import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fetchBinanceDay, checkBinanceKey, binanceCredentials } from "../dist/index.js";
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const input = { day: "2026-10-11", apiKey: "test-key", apiSecret: "test-secret" };

test("Binance GET-only signs requests, keeps product/decimal strings and drops private fields", async () => {
  const calls = [];
  const result = await fetchBinanceDay({ ...input, fetchImpl: async (url, options) => {
    const parsed = new URL(url); calls.push(parsed);
    if (parsed.pathname.endsWith("/time")) return json({ serverTime: 1791676800000 });
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["X-MBX-APIKEY"], input.apiKey);
    const signature = parsed.searchParams.get("signature"); parsed.searchParams.delete("signature");
    assert.equal(signature, createHmac("sha256", input.apiSecret).update(parsed.searchParams.toString()).digest("hex"));
    assert.equal(Number(parsed.searchParams.get("endTime")) - Number(parsed.searchParams.get("startTime")), 86400000 - 1);
    return json([{ customerId: "private@example.com", income: "0.123456789012", email: "private@example.com", unit: "BTC", secretNewField: "hidden" }]);
  } });
  assert.equal(calls.length, 4);
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.counts, { SPOT: 1, USD_M_FUTURES: 1 });
  assert.equal(result.records[0].income, "0.123456789012");
  assert.equal(result.records[1].product, "USD_M_FUTURES");
  assert.equal(JSON.stringify(result.records).includes("private"), false);
  assert.equal(JSON.stringify(result.records).includes("hidden"), false);
});

test("empty Binance lists succeed but limit-sized, malformed or partial fetches fail", async () => {
  const fake = (body) => async url => json(url.endsWith("/time") ? { serverTime: 1 } : body);
  assert.equal((await fetchBinanceDay({ ...input, fetchImpl: fake([]) })).records.length, 0);
  await assert.rejects(fetchBinanceDay({ ...input, fetchImpl: fake(Array.from({ length: 500 }, () => ({}))) }), error => error.code === "BINANCE_LIMIT_REACHED");
  await assert.rejects(fetchBinanceDay({ ...input, fetchImpl: fake({ data: [] }) }), error => error.code === "BINANCE_SCHEMA");
  await assert.rejects(fetchBinanceDay({ ...input, fetchImpl: async url => {
    if (url.endsWith("/time")) return json({ serverTime: 1 });
    return url.includes("fapi") ? json({ code: -2015 }, 400) : json([{ customerId: "123" }]);
  } }), error => error.action === "PAUSE");
  await assert.rejects(fetchBinanceDay({ ...input, day: "2026-02-30", fetchImpl: () => { throw Error("Must not request"); } }), error => error.code === "INVALID_DAY");
});

test("Binance rate limits defer shared slot, bans pause, network errors do not leak URLs", async () => {
  let delay = 0;
  await assert.rejects(fetchBinanceDay({ ...input, onThrottle: async ms => { delay = ms; },
    fetchImpl: async () => new Response("", { status: 429, headers: { "Retry-After": "120" } }) }), error => error.action === "RETRY");
  assert.equal(delay, 120000);
  await assert.rejects(fetchBinanceDay({ ...input, fetchImpl: async () => json({}, 418) }), error => error.action === "PAUSE");
  await assert.rejects(fetchBinanceDay({ ...input, fetchImpl: async () => { throw Error("key=test-key&signature=secret"); } }), error => !error.message.includes("secret") && error.code === "BINANCE_NETWORK");
});

test("Binance permission readiness accepts read-only without IP allowlist and rejects trading", async () => {
  const fake = (patch = {}) => async url => json(url.endsWith("/time") ? { serverTime: 1 } : { enableReading: true, ipRestrict: false, enableWithdrawals: false, ...patch });
  const ready = await checkBinanceKey({ ...input, fetchImpl: fake() });
  assert.equal(ready.ready, true); assert.equal(ready.ipWarning, true);
  assert.equal((await checkBinanceKey({ ...input, fetchImpl: fake({ enableFutures: true }) })).ready, false);
  const previous = process.env.BINANCE_AFFILIATE_API_KEY;
  process.env.BINANCE_AFFILIATE_API_KEY = "first"; const first = binanceCredentials().rootAccount;
  process.env.BINANCE_AFFILIATE_API_KEY = "second"; assert.notEqual(first, binanceCredentials().rootAccount);
  if (previous === undefined) delete process.env.BINANCE_AFFILIATE_API_KEY; else process.env.BINANCE_AFFILIATE_API_KEY = previous;
});

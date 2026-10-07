import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { fetchMexcDay, mapMexcRecords, minimizeMexcRecords, signMexc } from "../dist/index.js";

const row = (patch = {}) => ({ uid: "00123", inviteCode: "campaign", tradingAmount: "12.5", commission: "1.25", nickName: "private", ...patch });

test("MEXC signed pagination requests exact UTC day and keeps reported metrics", async () => {
  const calls = [];
  const pages = [
    { success: true, code: 0, data: { currentPage: 1, totalPage: 2, totalCount: 2, resultList: [row()] } },
    { success: true, code: 0, data: { currentPage: 2, totalPage: 2, totalCount: 2, resultList: [row({ uid: "99", commission: "0" })] } }
  ];
  const result = await fetchMexcDay({ day: "2026-09-25", apiKey: "key", apiSecret: "secret",
    fetchImpl: async (url, options) => { calls.push({ url: new URL(url), options }); return { status: 200, json: async () => pages.shift() }; }
  });
  assert.equal(result.records.length, 2);
  assert.equal(calls.length, 2);
  for (const [index, call] of calls.entries()) {
    const { signature, ...query } = Object.fromEntries(call.url.searchParams);
    assert.equal(signature, signMexc("secret", new URLSearchParams(query).toString()));
    assert.equal(call.options.headers["X-MEXC-APIKEY"], "key");
    assert.equal(query.page, String(index + 1));
    assert.equal(Number(query.endTime) - Number(query.startTime), 86_400_000 - 1);
  }
  const mapped = mapMexcRecords(result.records);
  assert.equal(mapped.metrics.find((metric) => metric.uid === "00123" && metric.kind === "REPORTED_COMMISSION").amount, "1.2500000000");
  assert.equal(mapped.metrics.find((metric) => metric.uid === "99" && metric.kind === "TRADE_VOLUME").asset, "USDT");
  assert.equal(JSON.stringify(mapped).includes("private"), false);
  assert.deepEqual(Object.keys(minimizeMexcRecords(result.records)[0]).sort(), ["commission", "inviteCode", "tradingAmount", "uid"]);
  assert.equal(signMexc("secret", "a=1"), createHmac("sha256", "secret").update("a=1").digest("hex"));
});

test("MEXC rejects incomplete pagination, duplicate UID and unsafe numeric UID", async () => {
  await assert.rejects(() => fetchMexcDay({ day: "2026-09-25", apiKey: "key", apiSecret: "secret",
    fetchImpl: async () => ({ status: 200, json: async () => ({ success: true, code: 0, data: { currentPage: 1, totalPage: 1, totalCount: 2, resultList: [row()] } }) })
  }), (error) => error.code === "INCOMPLETE_PAGINATION");
  assert.equal(mapMexcRecords([row(), row()]).duplicate, true);
  assert.throws(() => mapMexcRecords([row({ uid: 9_007_199_254_740_992 })]), /UID is invalid/);
  assert.throws(() => mapMexcRecords([row({ commission: "1e3" })]), /Invalid MEXC commission/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  activityDigest, assessQueryApi, canonicalQuery, classifyBybitError, classifyHeaders, dayState,
  fetchAffiliateDay, mapAffiliateRecords, signBybit, bybitAffiliateContract, bybitCsvContract
} from "../dist/index.js";

const record = (patch = {}) => ({
  userId: "00123", source: "code", tradeVol: "10", takerVol: "4", makerVol: "6", tradfiTradeVol: "",
  commissionsVol: { USDT: "1.5", BTC: "0" }, remarks: "hidden", ...patch
});

test("UC2/UC5 mapping keeps one volume row per UID and commission per asset", () => {
  const mapped = mapAffiliateRecords([record(), record({ userId: "99", commissionsVol: { USDT: "0", SOL: "2" } })]);
  const first = mapped.metrics.filter((row) => row.uid === "00123" && row.kind === "TRADE_VOLUME");
  assert.equal(first.length, 1);
  assert.equal(first[0].amount, "10.0000000000");
  assert.equal(mapped.metrics.filter((row) => row.uid === "00123" && row.kind === "REPORTED_COMMISSION").length, 2);
  assert.equal(mapped.metrics.find((row) => row.uid === "00123" && row.kind === "TRADFI_VOLUME").valueState, "EMPTY");
  assert.equal(JSON.stringify(mapped).includes("hidden"), false);
  assert.equal(mapped.duplicate, false);
});

test("UC1 digest ignores page order and UC11 detects a duplicate UID", () => {
  const left = mapAffiliateRecords([record(), record({ userId: "99", commissionsVol: { USDT: "0" } })]);
  const right = mapAffiliateRecords([record({ userId: "99", commissionsVol: { USDT: "0" } }), record()]);
  assert.equal(activityDigest(left.metrics), activityDigest(right.metrics));
  const duplicated = mapAffiliateRecords([record(), record()]);
  assert.equal(duplicated.duplicate, true);
});

test("UC6 additive field, UC7 alias, UC8 missing required", () => {
  const extra = classifyHeaders(["uid", "asset", "commission", "bonus"], bybitCsvContract);
  assert.equal(extra.class, "ADDITIVE");
  assert.deepEqual(extra.fields, ["bonus"]);
  const aliased = classifyHeaders(["userId", "tradeVolAlias"], { ...bybitAffiliateContract, fields: bybitAffiliateContract.fields.map((field) => field.source === "tradeVol" ? { ...field, aliases: ["tradeVolAlias"] } : field) });
  assert.equal(aliased.class, "BREAKING");
  const renamed = classifyHeaders(["uidAlias", "asset", "commission"], { ...bybitCsvContract, fields: bybitCsvContract.fields.map((field) => field.source === "uid" ? { ...field, aliases: ["uidAlias"] } : field) });
  assert.equal(renamed.class, "ALIASED");
  assert.throws(() => mapAffiliateRecords([{ userId: "1", source: "code", commissionsVol: {} }]), /Missing required field|Unparseable|SCHEMA_DRIFT/);
});

test("UC9 stops on an empty page and rejects a repeated cursor", async () => {
  const pages = [
    { retCode: 0, time: 1, result: { list: [record()], nextPageCursor: "page-2" } },
    { retCode: 0, time: 2, result: { list: [], nextPageCursor: "page-3" } }
  ];
  const fetched = await fetchAffiliateDay({
    day: "2026-09-01", apiKey: "key", apiSecret: "secret", reserve: async () => {},
    fetchImpl: async () => ({ status: 200, json: async () => pages.shift() })
  });
  assert.equal(fetched.records.length, 1);
  await assert.rejects(() => fetchAffiliateDay({
    day: "2026-09-01", apiKey: "key", apiSecret: "secret", reserve: async () => {},
    fetchImpl: async () => ({ status: 200, json: async () => ({ retCode: 0, result: { list: [record()], nextPageCursor: "same" } }) })
  }), /repeated a page cursor/);
});

test("UC12 classifies auth and rate-limit errors and checks key readiness", () => {
  assert.equal(classifyBybitError(10006).action, "RETRY");
  assert.equal(classifyBybitError(610015).action, "QUARANTINE");
  assert.equal(classifyBybitError(10005).action, "PAUSE");
  const ready = assessQueryApi({ readOnly: 1, permissions: { Affiliate: ["Affiliate"] }, ips: ["*"], expiredAt: "2026-12-26T00:00:00.000Z" }, new Date("2026-09-26T00:00:00.000Z"));
  assert.equal(ready.ready, true);
  assert.equal(ready.ipWarning, true);
  const expired = assessQueryApi({ readOnly: 1, permissions: { Affiliate: ["Affiliate"], Wallet: ["Account"] }, ips: ["1.1.1.1"], expiredAt: "2026-01-01T00:00:00.000Z" }, new Date("2026-09-26T00:00:00.000Z"));
  assert.equal(expired.ready, false);
  assert.equal(dayState("2026-09-26", "2026-09-26"), "OPEN");
  assert.equal(dayState("2026-09-24", "2026-09-26"), "SETTLING");
  assert.equal(dayState("2026-09-01", "2026-09-26"), "SEALED");
});

test("Bybit signature matches HMAC of timestamp, key, window and canonical query", () => {
  const query = canonicalQuery({ endDate: "2026-09-01", size: "100", startDate: "2026-09-01" });
  assert.equal(query, "endDate=2026-09-01&size=100&startDate=2026-09-01");
  const expected = createHmac("sha256", "secret").update(`1000key5000${query}`).digest("hex");
  assert.equal(signBybit("secret", "1000", "key", "5000", query), expected);
});

// Shape of a real aff-user-list row with startDate/endDate (probe 2026-09-26), values synthetic.
const liveRow = (patch = {}) => ({
  userId: "100000001", registerTime: "2025-02-01", source: "123456", remarks: "", isKyc: false,
  takerVol30Day: "", makerVol30Day: "", tradeVol30Day: "", depositAmount30Day: "",
  takerVol365Day: "", makerVol365Day: "", tradeVol365Day: "", depositAmount365Day: "",
  takerVol: "", makerVol: "", tradeVol: "", startDate: "2026-09-25", endDate: "2026-09-25",
  tradfiTradeVol: "0", tradfiTradeVol30Day: "", tradfiTradeVol365Day: "",
  commissions30Day: {}, commissionsVol: { BTC: "0", ETH: "0", MNT: "0", USDC: "0", USDT: "0" }, commissions365Day: {}, ...patch
});

test("a real-shaped response is SAME, not ADDITIVE, and new assets are ADDITIVE against the accepted schema", () => {
  const first = mapAffiliateRecords([liveRow()]);
  assert.equal(first.drift.class, "SAME");
  assert.deepEqual(first.warnings, []);
  const again = mapAffiliateRecords([liveRow()], first.fingerprint);
  assert.equal(again.drift.class, "SAME");
  const withSol = mapAffiliateRecords([liveRow({ commissionsVol: { BTC: "0", ETH: "0", MNT: "0", USDC: "0", USDT: "0", SOL: "1" } })], first.fingerprint);
  assert.equal(withSol.drift.class, "ADDITIVE");
  assert.ok(withSol.metrics.some((row) => row.asset === "SOL" && row.amount === "1.0000000000"));
});

test("row date echo mismatch quarantines, HTTP 403 pauses, non-JSON retries", async () => {
  const page = (list) => ({ status: 200, json: async () => ({ retCode: 0, result: { list, nextPageCursor: "" } }) });
  await assert.rejects(() => fetchAffiliateDay({ day: "2026-09-24", apiKey: "k", apiSecret: "s", fetchImpl: async () => page([liveRow()]) }),
    (error) => error.code === "DATE_ECHO" && error.action === "QUARANTINE");
  const ok = await fetchAffiliateDay({ day: "2026-09-25", apiKey: "k", apiSecret: "s", fetchImpl: async () => page([liveRow()]) });
  assert.equal(ok.records.length, 1);
  await assert.rejects(() => fetchAffiliateDay({ day: "2026-09-25", apiKey: "k", apiSecret: "s", fetchImpl: async () => ({ status: 403, json: async () => { throw new Error("html"); } }) }),
    (error) => error.code === "HTTP_403" && error.action === "PAUSE");
  await assert.rejects(() => fetchAffiliateDay({ day: "2026-09-25", apiKey: "k", apiSecret: "s", fetchImpl: async () => ({ status: 200, json: async () => { throw new Error("html"); } }) }),
    (error) => error.code === "NON_JSON" && error.action === "RETRY");
});

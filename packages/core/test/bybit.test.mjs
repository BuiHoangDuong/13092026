import test from "node:test";
import assert from "node:assert/strict";
import { parseBybitCsv, cashbackTarget, holdingHours } from "../dist/index.js";
import { Prisma } from "@cashback/db";

const metadata = { rootAccount: "affiliate", periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-02T23:59:59Z"), reportType: "AGGREGATE", sourceTz: "UTC" };
const csv = text => Buffer.from(text);
test("Bybit totals preserve UID, decimal precision and asset; commission is not volume", () => {
  const [row] = parseBybitCsv(csv('uid,asset,commission\n00123,usdt,"100.0000000001"'), metadata);
  assert.deepEqual(row.flags, []);
  assert.equal(row.normalized.uid, "00123");
  assert.equal(row.normalized.amount, "100.0000000001");
  assert.equal(row.normalized.asset, "USDT");
  assert.equal(cashbackTarget(new Prisma.Decimal(row.normalized.amount), new Prisma.Decimal("0.3")).toFixed(10), "30.0000000000");
});
test("No transaction identity means aggregate; transaction identities survive reordered imports", () => {
  const [aggregate] = parseBybitCsv(csv("uid,asset,commission\n123,USDT,10"), { ...metadata, reportType: "TRANSACTION" });
  assert.equal(aggregate.normalized.reportType, "AGGREGATE");
  const [original] = parseBybitCsv(csv("uid,asset,commission,transaction_id,occurred_at\n123,USDT,10,trade-1,2026-09-01T10:00:00Z"), { ...metadata, reportType: "TRANSACTION" });
  const [correction] = parseBybitCsv(csv("asset,commission,uid,occurred_at,transaction_id\nUSDT,12,123,2026-09-01T10:00:00Z,trade-1"), { ...metadata, reportType: "TRANSACTION" });
  assert.equal(original.normalized.dedupKey, correction.normalized.dedupKey);
});
test("Invalid rows, duplicate keys and unsafe formats are blocked", () => {
  const rows = parseBybitCsv(csv("uid,asset,commission\n123,USDT,10\n123,USDT,12\n=2+2,USDT,5\n456,USDT,-5"), metadata);
  assert(rows[1].flags.includes("DUPLICATE_KEY"));
  assert(rows[2].flags.includes("INVALID_UID"));
  assert(rows[3].flags.includes("INVALID_COMMISSION"));
  assert.throws(() => parseBybitCsv(csv("uid,asset,volume\n123,USDT,100"), metadata));
  assert.throws(() => parseBybitCsv(csv("uid,asset,commission\n123,USDT,100"), { ...metadata, sourceTz: "Asia/Bangkok" }));
  assert.throws(() => parseBybitCsv(csv("uid,uid,asset,commission\n123,123,USDT,100"), metadata));
});
test("Holding duration must be explicit; invalid financial inputs fail", () => {
  const saved = process.env.HOLDING_PERIOD_HOURS;
  try {
    delete process.env.HOLDING_PERIOD_HOURS; assert.equal(holdingHours(), null);
    process.env.HOLDING_PERIOD_HOURS = "0"; assert.equal(holdingHours(), 0);
    process.env.HOLDING_PERIOD_HOURS = "-1"; assert.throws(holdingHours);
    assert.throws(() => cashbackTarget(new Prisma.Decimal("1"), new Prisma.Decimal("1.1")));
  } finally { if (saved === undefined) delete process.env.HOLDING_PERIOD_HOURS; else process.env.HOLDING_PERIOD_HOURS = saved; }
});

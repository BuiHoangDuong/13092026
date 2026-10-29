import test from "node:test";
import assert from "node:assert/strict";
import { db, Prisma } from "@cashback/db";
import { inclusivePeriodUtc } from "@cashback/contracts";
import { latestReportedDay, lookupCashback, summarizePublishedCashback } from "../dist/index.js";

const date = text => new Date(text);
const row = (start, end, amount) => ({ periodStart: date(start), periodEnd: date(end), creditedCashback: new Prisma.Decimal(amount) });
const start = date("2026-10-20T00:00:00Z"), end = date("2026-10-21T00:00:00Z");

test("an inclusive source day fits wholly inside the half-open summary window", () => {
  const period = inclusivePeriodUtc("2026-10-20", "2026-10-20", "UTC");
  assert.equal(period.periodEnd, "2026-10-20T23:59:59.999Z");
  assert.deepEqual(summarizePublishedCashback([row(period.periodStart, period.periodEnd, "7")], start, end, true), { status: "REPORTED", amount: "7.0000000000" });
  assert.deepEqual(summarizePublishedCashback([row(period.periodStart, "2026-10-21T00:00:00Z", "7")], start, end, true), { status: "INSUFFICIENT_DETAIL", amount: null });
});

test("UTC day includes its own reports, excludes current-day reports, and distinguishes zero from missing", () => {
  assert.deepEqual(summarizePublishedCashback([], start, end, true), { status: "REPORTED", amount: "0.0000000000" });
  assert.deepEqual(summarizePublishedCashback([row("2026-10-20T00:00:00Z", "2026-10-20T23:59:59.999Z", "0")], start, end, true), { status: "REPORTED", amount: "0.0000000000" });
  const reports = [row("2026-10-20T00:00:00Z", "2026-10-20T23:59:59.999Z", "0.1"), row("2026-10-20T12:00:00Z", "2026-10-20T15:00:00Z", "0.2"), row("2026-10-21T00:00:00Z", "2026-10-21T23:59:59Z", "999")];
  assert.equal(summarizePublishedCashback(reports, start, end, true).amount, "0.3000000000");
});

test("multi-day reports are included whole when contained; crossing a window is never prorated", () => {
  const report = row("2026-10-01T00:00:00Z", "2026-10-20T23:59:59.999Z", "300");
  assert.deepEqual(summarizePublishedCashback([report], start, end, true), { status: "INSUFFICIENT_DETAIL", amount: null });
  assert.equal(summarizePublishedCashback([report], date("2026-09-21T00:00:00Z"), end, true).amount, "300.0000000000");
  assert.equal(summarizePublishedCashback([row("2026-09-01T00:00:00Z", "2026-10-01T00:00:00Z", "1")], date("2026-09-21T00:00:00Z"), end, true).status, "INSUFFICIENT_DETAIL");
});

test("summary is not capped at the visible 100-row page", () => {
  const reports = Array.from({ length: 130 }, () => row("2026-10-20T00:00:00Z", "2026-10-20T23:59:59Z", "1.0000000001"));
  assert.equal(summarizePublishedCashback(reports, start, end, true).amount, "130.0000000130");
});

test("without a covered day metrics remain NO_DATA even for boundary records", () => {
  assert.deepEqual(summarizePublishedCashback([], start, end, false), { status: "NO_DATA", amount: null });
  assert.deepEqual(summarizePublishedCashback([row("2026-10-01T00:00:00Z", "2026-10-20T23:59:59Z", "5")], start, end, false), { status: "NO_DATA", amount: null });
});

test("lookup anchors every summary query to D, preserves privacy and sums beyond the page", async t => {
  const original = db.$transaction;
  const day = date("2026-10-10T00:00:00Z");
  const reports = Array.from({ length: 130 }, (_, i) => ({ id: `row-${i}`, asset: "USDT", ...row("2026-10-10T00:00:00Z", "2026-10-10T23:59:59.999Z", "1") }));
  let known = true, attributed = true, covered = true, emptyPeriod = false, summaryQuery;
  const tx = {
    $queryRaw: async query => query.sql.includes("RateLimitCounter") ? [{ count: 1 }] : query.sql.includes("MAX(candidate.day)") ? [{ day: covered ? day : null }] : [],
    uidAccount: { findUnique: async () => known ? { id: "account" } : null },
    wallet: { findMany: async () => [{ asset: "USDT", withdrawn: new Prisma.Decimal("7.5") }] },
    commissionRecord: {
      findFirst: async () => attributed ? { id: "attribution" } : null,
      findMany: async query => {
        if (query.take) return reports.slice(0, query.take).map(record => emptyPeriod ? { ...record, periodStart: date("2026-08-01T00:00:00Z"), periodEnd: date("2026-08-01T23:59:59Z") } : record);
        summaryQuery = query;
        return emptyPeriod ? [] : reports;
      }
    }
  };
  db.$transaction = async (operation, options) => {
    if (options) assert.equal(options.isolationLevel, "RepeatableRead");
    return operation(tx);
  };
  t.after(() => { db.$transaction = original; });
  const lookup = () => lookupCashback({ exchangeId: "exchange", uid: "00123" }, "127.0.0.1");
  const result = await lookup();
  assert.deepEqual(result.summaryPeriods, { reportDay: "2026-10-10", rollingStart: "2026-09-11T00:00:00.000Z", end: "2026-10-11T00:00:00.000Z" });
  assert.deepEqual(summaryQuery.where.periodStart, { lt: date(result.summaryPeriods.end) });
  assert.deepEqual(summaryQuery.where.periodEnd, { gte: date(result.summaryPeriods.rollingStart) });
  assert.equal(summaryQuery.take, undefined);
  assert.equal(result.balances[0].previousDay.amount, "130.0000000000");
  assert.equal(result.balances[0].rolling30Days.amount, "130.0000000000");
  assert.equal(result.balances[0].totalPaid, "7.5000000000");
  assert.equal(result.transactions.length, 100); assert.equal(result.hasMore, true);
  assert.ok(result.transactions.every(record => record.uid === "00123"));
  emptyPeriod = true;
  const zero = await lookup();
  assert.equal(zero.hasData, true); assert.equal(zero.balances[0].previousDay.amount, "0.0000000000");
  assert.equal(zero.balances[0].rolling30Days.amount, "0.0000000000");
  covered = false;
  const missingDay = await lookup();
  assert.deepEqual(missingDay.summaryPeriods, { reportDay: null, rollingStart: null, end: null });
  assert.deepEqual(missingDay.balances[0].previousDay, { status: "NO_DATA", amount: null });
  covered = true; attributed = false;
  const knownEmpty = await lookup();
  known = false;
  const unknown = await lookup();
  assert.deepEqual(knownEmpty, unknown);
  assert.equal(unknown.hasData, false); assert.deepEqual(unknown.balances, []); assert.deepEqual(unknown.transactions, []); assert.equal(unknown.hasMore, false);
});

test("latestReportedDay passes the exchange and UTC cutoff as parameters", async () => {
  let query;
  const tx = { $queryRaw: async input => { query = input; return [{ day: null }]; } };
  assert.equal(await latestReportedDay(tx, "exchange'quoted", date("2026-10-30T23:59:59Z")), null);
  assert.ok(query.values.includes("exchange'quoted"));
  assert.ok(query.values.some(value => value instanceof Date && value.toISOString() === "2026-10-30T00:00:00.000Z"));
  assert.ok(!query.sql.includes("exchange'quoted"));
});

test("Docker coverage rejects partial, non-UTC-day, unpublished, activity and future batches", { skip: process.env.RUN_DOCKER_LOOKUP_TESTS !== "1" }, async () => {
  assert.ok(["localhost", "127.0.0.1", "postgres"].includes(new URL(process.env.DATABASE_URL).hostname), "Docker DB only");
  const rollback = new Error("ROLLBACK_COVERAGE_FIXTURE");
  await assert.rejects(db.$transaction(async tx => {
    const exchange = await tx.exchange.create({ data: { slug: `coverage-${Date.now()}`, name: "Coverage fixture" } });
    const now = date("2026-10-30T18:00:00Z");
    const batch = patch => tx.importBatch.create({ data: { exchangeId: exchange.id, rootAccount: "test", datasetKind: "COMMISSION", sourceMethod: "NORMALIZED_FILE", status: "PUBLISHED", reportType: "AGGREGATE", periodStart: date("2026-10-29T00:00:00Z"), periodEnd: date("2026-10-29T23:59:59.999Z"), sourceTz: "UTC", fileRef: "synthetic", ...patch } });
    assert.equal(await latestReportedDay(tx, exchange.id, now), null);
    await batch({ datasetKind: "REFERRAL_ACTIVITY" });
    await batch({ status: "PREVIEW" });
    await batch({ sourceAsOf: date("2026-10-29T23:59:59Z") });
    await batch({ periodStart: date("2026-10-28T00:00:00Z") });
    await batch({ periodStart: date("2026-10-29T07:00:00Z"), periodEnd: date("2026-10-30T06:59:59.999Z"), sourceTz: "America/Los_Angeles" });
    await batch({ periodStart: date("2026-10-30T00:00:00Z"), periodEnd: date("2026-10-30T23:59:59.999Z") });
    assert.equal(await latestReportedDay(tx, exchange.id, now), null);
    await batch({ periodStart: date("2026-10-26T00:00:00Z"), periodEnd: date("2026-10-26T23:59:59.999Z"), sourceAsOf: date("2026-10-27T00:00:00Z") });
    assert.equal((await latestReportedDay(tx, exchange.id, now)).toISOString(), "2026-10-26T00:00:00.000Z");
    await batch({});
    assert.equal((await latestReportedDay(tx, exchange.id, now)).toISOString(), "2026-10-29T00:00:00.000Z");
    await tx.importBatch.deleteMany({ where: { exchangeId: exchange.id } });
    await batch({ reportType: "TRANSACTION", periodStart: date("2026-10-27T06:00:00Z"), periodEnd: date("2026-10-29T12:00:00Z") });
    assert.equal((await latestReportedDay(tx, exchange.id, now)).toISOString(), "2026-10-28T00:00:00.000Z");
    await batch({ reportType: "TRANSACTION", periodStart: date("2026-10-27T06:00:00Z"), periodEnd: date("2026-10-30T12:00:00Z") });
    assert.equal((await latestReportedDay(tx, exchange.id, now)).toISOString(), "2026-10-29T00:00:00.000Z");
    assert.equal((await latestReportedDay(tx, exchange.id, date("2026-10-29T12:00:00Z"))).toISOString(), "2026-10-28T00:00:00.000Z");
    throw rollback;
  }, { timeout: 30_000 }), error => error === rollback);
});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const originalUrl = process.env.TEST_DATABASE_URL;
if (!originalUrl) throw new Error("Set TEST_DATABASE_URL explicitly to a dedicated test database");
if (!["localhost", "127.0.0.1", "postgres"].includes(new URL(originalUrl).hostname))
  throw new Error("TEST_DATABASE_URL must point to the local Docker Postgres service");
const schema = `cashback_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(originalUrl);
url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.href;
const { PrismaClient } = await import("../packages/db/dist/generated/client/index.js");
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
const metric = (uid, kind, asset, amount) => ({ uid, referralCode: "code", kind, asset, valueState: amount === "" ? "EMPTY" : "VALUE", amount: amount === "" ? null : amount });

try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const dbRequire = createRequire(path.join(root, "packages/db/package.json"));
  const migrated = await new Promise((resolve, reject) => {
    execFile(process.execPath, [dbRequire.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.join(root, "packages/db"), env: process.env, timeout: 180000, maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout }));
  }).catch((error) => ({ stdout: String(error.stdout ?? ""), failed: true, stderr: String(error.stderr ?? "") }));
  if (migrated.failed && !migrated.stdout.includes("applied") && !migrated.stdout.includes("No pending")) throw new Error(migrated.stderr.replaceAll(originalUrl, "[database]"));
  const { db } = await import("../packages/db/dist/index.js");
  const { publishApiDay } = await import("../packages/core/dist/index.js");
  const exchange = await db.exchange.create({ data: { slug: "bybit", name: "Bybit", status: "PUBLISHED" } });
  const run = await db.syncRun.create({ data: { exchangeId: exchange.id, rootAccount: "root", trigger: "MANUAL", state: "RUNNING", contractVersion: "bybit-affiliate@1", startedAt: new Date() } });
  const before = { commission: await db.commissionRecord.count(), wallet: await db.walletEntry.count(), withdrawal: await db.withdrawal.count() };
  const day = { exchangeId: exchange.id, rootAccount: "root", periodDate: "2026-09-01", runId: run.id, fingerprint: "fp", observedAt: new Date(), sourceAsOf: null, state: "SEALED", contractVersion: "bybit-affiliate@1" };
  const first = [metric("001", "TRADE_VOLUME", "USDT", "10.0000000000"), metric("001", "REPORTED_COMMISSION", "USDT", "1.0000000000"), metric("002", "TRADE_VOLUME", "USDT", "")];
  const created = await db.$transaction((tx) => publishApiDay(tx, { ...day, metrics: first, updateRoster: true }), { timeout: 30000 });
  assert.equal(created.unchanged, false);
  assert.equal(await db.activityMetricCurrent.count({ where: { valueState: "VALUE" } }), 2);
  assert.equal(await db.activityRoster.count({ where: { state: "ACTIVE" } }), 2);
  const same = await db.$transaction((tx) => publishApiDay(tx, { ...day, metrics: first, updateRoster: true }), { timeout: 30000 });
  assert.equal(same.unchanged, true);
  assert.equal(await db.activityMetricChange.count(), created.changed);
  const corrected = await db.$transaction((tx) => publishApiDay(tx, { ...day, metrics: [metric("001", "TRADE_VOLUME", "USDT", "12.0000000000"), metric("001", "REPORTED_COMMISSION", "USDT", "1.0000000000")], updateRoster: true }), { timeout: 30000 });
  assert.ok(corrected.changed >= 1);
  const volume = await db.activityMetricCurrent.findFirst({ where: { uid: "001", kind: "TRADE_VOLUME" } });
  assert.equal(volume.amount.toFixed(10), "12.0000000000");
  assert.equal(await db.activityMetricCurrent.count({ where: { uid: "002", valueState: "ABSENT" } }), 0);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await db.$transaction((tx) => publishApiDay(tx, { ...day, periodDate: "2026-09-02", metrics: [metric("001", "TRADE_VOLUME", "USDT", "1.0000000000")], updateRoster: true, state: "SETTLING" }), { timeout: 30000 });
  }
  assert.equal((await db.activityRoster.findUnique({ where: { exchangeId_rootAccount_uid: { exchangeId: exchange.id, rootAccount: "root", uid: "002" } } })).state, "GONE");
  // 1,200 UIDs x 9 metrics = 10,800 rows: must not hit the 65,535 bind-parameter limit.
  const large = [];
  for (let index = 0; index < 1200; index += 1) {
    const uid = String(100000 + index);
    for (const kind of ["TRADE_VOLUME", "TAKER_VOLUME", "MAKER_VOLUME", "TRADFI_VOLUME"]) large.push(metric(uid, kind, "USDT", index % 10 ? "" : "5.0000000000"));
    for (const asset of ["BTC", "ETH", "MNT", "USDC", "USDT"]) large.push(metric(uid, "REPORTED_COMMISSION", asset, "0.0000000000"));
  }
  await db.$transaction((tx) => publishApiDay(tx, { ...day, periodDate: "2026-09-03", metrics: large, updateRoster: false }), { timeout: 60000 });
  // Sparse: only the nonzero volumes (every 10th UID x 4 kinds) are stored; zeros and empties are not.
  assert.equal(await db.activityMetricCurrent.count({ where: { periodDate: new Date("2026-09-03T00:00:00.000Z") } }), 120 * 4);
  assert.equal((await db.activityPeriodStatus.findFirst({ where: { periodDate: new Date("2026-09-03T00:00:00.000Z") } })).rowCount, 1200);
  // End to end: scheduler claim, runSyncJob with a fake Bybit, drift pause, transient retry.
  process.env.BYBIT_AFFILIATE_API_KEY = "fake-key";
  process.env.BYBIT_AFFILIATE_API_SECRET = "fake-secret";
  process.env.BYBIT_AFFILIATE_MASTER_UID = "root-e2e";
  const core = await import("../packages/core/dist/index.js");
  const today = new Date().toISOString().slice(0, 10);
  const keyInfo = { retCode: 0, result: { readOnly: 1, permissions: { Affiliate: ["Affiliate"], Spot: [] }, ips: ["*"], expiredAt: "2099-01-01T00:00:00Z" } };
  const row = (uid, day, patch = {}) => ({ userId: uid, source: "123456", remarks: "", isKyc: false, registerTime: "2025-02-01", startDate: day, endDate: day,
    takerVol: "", makerVol: "", tradeVol: "", tradfiTradeVol: "0", takerVol30Day: "", makerVol30Day: "", tradeVol30Day: "", takerVol365Day: "",
    makerVol365Day: "", tradeVol365Day: "", tradfiTradeVol30Day: "", tradfiTradeVol365Day: "", depositAmount30Day: "", depositAmount365Day: "",
    commissions30Day: {}, commissions365Day: {}, commissionsVol: { USDT: uid === "9001" ? "0.5" : "0" }, ...patch });
  const fakeBybit = (mode) => async (url) => {
    if (url.includes("query-api")) return mode === "429" ? { status: 429, json: async () => ({}) } : { status: 200, json: async () => keyInfo };
    const day = new URL(url).searchParams.get("startDate");
    const list = mode === "drift" ? [row("9001", day, { tradeVol: undefined, takerVol: undefined })].map((r) => { delete r.tradeVol; return r; }) : [row("9001", day), row("9002", day)];
    return { status: 200, json: async () => ({ retCode: 0, time: Date.now(), result: { list, nextPageCursor: "" } }) };
  };
  await core.refreshBybitReadiness(fakeBybit("normal"));
  assert.equal((await core.getSyncConfig(exchange.id)).readiness.ready, true);
  assert.equal((await core.getSyncConfig(exchange.id)).readiness.ipWarning, true);
  await db.exchangeSyncConfig.update({ where: { exchangeId: exchange.id }, data: { backfillDays: 0 } });
  const workerKey = process.env.BYBIT_AFFILIATE_API_KEY;
  const workerSecret = process.env.BYBIT_AFFILIATE_API_SECRET;
  const workerRoot = process.env.BYBIT_AFFILIATE_MASTER_UID;
  delete process.env.BYBIT_AFFILIATE_API_KEY;
  delete process.env.BYBIT_AFFILIATE_API_SECRET;
  delete process.env.BYBIT_AFFILIATE_MASTER_UID;
  const enabledFromWeb = await core.updateSyncConfig("test-admin", exchange.id, { enabled: true });
  assert.equal(enabledFromWeb.enabled, true, "web enables from the worker snapshot without its credentials");
  assert.equal(enabledFromWeb.readiness.ready, true);
  await db.exchangeSyncConfig.update({ where: { exchangeId: exchange.id }, data: { readinessCheckedAt: new Date(Date.now() - 10 * 60_000) } });
  await assert.rejects(() => core.requestSync("test-admin", exchange.id, "MANUAL", [today]), (error) => error.code === "READINESS_STALE");
  process.env.BYBIT_AFFILIATE_API_KEY = workerKey;
  process.env.BYBIT_AFFILIATE_API_SECRET = workerSecret;
  process.env.BYBIT_AFFILIATE_MASTER_UID = workerRoot;
  await core.refreshBybitReadiness(fakeBybit("normal"));
  await core.updateSyncConfig("test-admin", exchange.id, { enabled: false });
  await db.job.deleteMany({ where: { type: "SYNC", payload: { path: ["exchangeId"], equals: exchange.id } } });
  await db.exchange.update({ where: { id: exchange.id }, data: { slug: "bybit-sink-test" } });
  const bybit2 = await db.exchange.create({ data: { slug: "bybit", name: "Bybit E2E", status: "PUBLISHED" } });
  await db.exchangeSyncConfig.create({ data: { exchangeId: bybit2.id, rootAccount: "root-e2e", enabled: true, intervalMinutes: 30, nextRunAt: new Date(Date.now() - 1000) } });
  await Promise.all([core.scheduleDueSyncs(), core.scheduleDueSyncs()]);
  const queued = await db.job.findMany({ where: { type: "SYNC", payload: { path: ["exchangeId"], equals: bybit2.id } } });
  assert.equal(queued.length, 1, "two scheduler replicas enqueue one run");
  async function runOne(mode) {
    const job = await core.claimNextJob(120, "sync-test");
    assert.equal(job.type, "SYNC");
    const lease = { id: job.id, lockedBy: job.lockedBy };
    try {
      await core.runSyncJob(lease, job.payload, fakeBybit(mode));
      for (;;) {
        const pending = await db.job.findFirst({ where: { type: "TRANSFORM", state: "PENDING" } });
        if (!pending) break;
        const transform = await core.claimNextJob(120, "sync-transform-test");
        assert.equal(transform.type, "TRANSFORM");
        await core.transformApiJob({ id: transform.id, lockedBy: transform.lockedBy }, transform.payload.loadId);
      }
      return "done";
    }
    catch (error) { await core.failJob(lease, job.attempts, error); return error.code ?? error.message; }
  }
  assert.equal(await runOne("ok"), "done");
  const okRun = await db.syncRun.findFirst({ where: { exchangeId: bybit2.id }, orderBy: { createdAt: "desc" } });
  assert.equal(okRun.state, "SUCCEEDED");
  assert.equal(okRun.driftReport.class, "SAME", "real-shaped rows report no drift");
  assert.equal(await db.activityRoster.count({ where: { exchangeId: bybit2.id, state: "ACTIVE" } }), 2);
  assert.equal(await db.activityMetricCurrent.count({ where: { exchangeId: bybit2.id } }), 3, "only the nonzero commission is stored, once per open day");
  await db.job.create({ data: { type: "SYNC", payload: { exchangeId: bybit2.id, trigger: "MANUAL", dates: [today] } } });
  assert.equal(await runOne("429"), "HTTP_429");
  await db.job.updateMany({ where: { type: "SYNC", state: "PENDING" }, data: { runAfter: new Date(0) } });
  assert.equal(await runOne("429"), "HTTP_429");
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: bybit2.id } })).pausedReason, null, "transient failures do not pause");
  await db.job.updateMany({ where: { type: "SYNC", state: "PENDING" }, data: { state: "DONE" } });
  await db.job.create({ data: { type: "SYNC", payload: { exchangeId: bybit2.id, trigger: "MANUAL", dates: [today] } } });
  assert.equal(await runOne("drift"), "done");
  const driftRun = await db.syncRun.findFirst({ where: { exchangeId: bybit2.id }, orderBy: { createdAt: "desc" } });
  assert.equal(driftRun.state, "QUARANTINED");
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: bybit2.id } })).pausedReason, "SCHEMA_DRIFT", "breaking drift pauses");
  assert.equal(await db.activityMetricCurrent.count({ where: { exchangeId: bybit2.id } }), 3, "quarantined run writes nothing");
  assert.equal(await db.commissionRecord.count(), before.commission);
  assert.equal(await db.walletEntry.count(), before.wallet);
  assert.equal(await db.withdrawal.count(), before.withdrawal);
  await db.$transaction((tx) => publishApiDay(tx, { ...day, rootAccount: "second-root", metrics: [metric("001", "TRADE_VOLUME", "USDT", "4.0000000000")], updateRoster: true }), { timeout: 30000 });
  const periodStart = "2026-09-01T00:00:00.000Z";
  const periodEnd = "2026-09-02T23:59:59.999Z";
  const batch = await db.importBatch.create({ data: {
    exchangeId: exchange.id, rootAccount: "manual-root", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE",
    periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), sourceTz: "UTC", sourceAsOf: new Date("2026-09-03T00:00:00.000Z"),
    fileRef: "test.xlsx", status: "PUBLISHED"
  } });
  await db.referralSnapshot.create({ data: {
    batchId: batch.id, exchangeId: exchange.id, rootAccount: "manual-root", uid: "001",
    periodStart: new Date(periodStart), periodEnd: new Date(periodEnd), tradingVolume: "7", tradingAsset: "USDT",
    reportedEarnings: "0.5", earningsAsset: "USDT", referralCode: "manual-code",
    metrics: { create: [{ kind: "TRADE_VOLUME", asset: "USDT", valueState: "VALUE", amount: "7" }] }
  } });
  const page1 = await core.listReportedActivity({ exchangeId: exchange.id, periodStart, periodEnd, limit: 1 });
  assert.equal(page1.nextCursor, "001");
  assert.deepEqual(page1.activity.map((row) => `${row.source}:${row.rootAccount}`).sort(), ["API:root", "API:second-root", "MANUAL:manual-root"]);
  assert.equal(page1.activity.find((row) => row.source === "API" && row.rootAccount === "root").metrics.find((item) => item.kind === "TRADE_VOLUME").amount, "13.0000000000");
  assert.equal(page1.activity.find((row) => row.source === "API" && row.rootAccount === "second-root").metrics.find((item) => item.kind === "TRADE_VOLUME").amount, "4.0000000000");
  assert.equal(page1.activity.find((row) => row.source === "API" && row.rootAccount === "root").partial, true, "settling day marks aggregate partial");
  const page2 = await core.listReportedActivity({ exchangeId: exchange.id, periodStart, periodEnd, limit: 1, cursor: page1.nextCursor });
  assert.deepEqual(page2.activity.map((row) => row.uid), ["002"]);
  assert.equal(page2.activity[0].dataState, "INCOMPLETE");
  assert.equal(page2.nextCursor, null);
  const cutDay = await core.listReportedActivity({ exchangeId: exchange.id, periodStart: "2026-09-01T01:00:00.000Z", periodEnd: "2026-09-01T22:59:59.999Z" });
  assert.equal(cutDay.coverageDays.find((item) => item.rootAccount === "root").expected, 1);
  assert.equal(cutDay.activity.find((row) => row.uid === "001" && row.source === "API").partial, true);
  const unfetched = await core.listReportedActivity({ exchangeId: exchange.id, periodStart: "2026-08-20T00:00:00.000Z", periodEnd: "2026-08-21T23:59:59.999Z", limit: 1 });
  assert.equal(unfetched.activity.find((row) => row.uid === "001" && row.rootAccount === "root").dataState, "INCOMPLETE");
  assert.deepEqual(unfetched.coverageDays.find((item) => item.rootAccount === "root"), { rootAccount: "root", expected: 2, fetched: 0, open: 0, missing: 2 });
  // MEXC follows the same worker → raw landing → transform → activity sink path.
  const mexc = await db.exchange.create({ data: { slug: "mexc", name: "MEXC", status: "PUBLISHED" } });
  process.env.MEXC_AFFILIATE_API_KEY = "fake-mexc-key";
  process.env.MEXC_AFFILIATE_API_SECRET = "fake-mexc-secret";
  process.env.MEXC_AFFILIATE_MASTER_UID = "mexc-root";
  const fakeMexc = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return { status: 200, json: async () => ({ success: true, code: 0, data: { currentPage: page, totalPage: 1, totalCount: 1,
      resultList: [{ uid: "00123", inviteCode: "code", tradingAmount: "12.5", commission: "1.25", nickName: "private" }] } }) };
  };
  await core.refreshMexcReadiness(fakeMexc);
  assert.equal((await core.getSyncConfig(mexc.id)).readiness.ready, true);
  await db.exchangeSyncConfig.update({ where: { exchangeId: mexc.id }, data: { backfillDays: 0 } });
  await core.updateSyncConfig("test-admin", mexc.id, { enabled: true });
  const mexcJob = await core.claimNextJob(120, "mexc-sync-test");
  assert.equal(mexcJob.type, "SYNC");
  assert.equal(mexcJob.payload.exchangeId, mexc.id);
  await core.runSyncJob({ id: mexcJob.id, lockedBy: mexcJob.lockedBy }, mexcJob.payload, fakeMexc);
  for (;;) {
    const pending = await db.job.findFirst({ where: { type: "TRANSFORM", state: "PENDING" } });
    if (!pending) break;
    const transform = await core.claimNextJob(120, "mexc-transform-test");
    assert.equal(transform.type, "TRANSFORM");
    await core.transformApiJob({ id: transform.id, lockedBy: transform.lockedBy }, transform.payload.loadId);
  }
  assert.equal((await db.syncRun.findFirst({ where: { exchangeId: mexc.id }, orderBy: { createdAt: "desc" } })).state, "SUCCEEDED");
  assert.equal(await db.activityMetricCurrent.count({ where: { exchangeId: mexc.id, uid: "00123" } }), 6);
  const mexcLoads = await db.rawLoad.findMany({ where: { exchangeId: mexc.id } });
  assert.equal(mexcLoads.length, 3);
  assert.ok(mexcLoads.every((load) => !load.fieldNames.includes("nickName")));
  assert.equal(await db.commissionRecord.count(), before.commission);
  assert.equal(await db.walletEntry.count(), before.wallet);
  console.log("PASS: Bybit and MEXC API activity sync without wallet attribution");
} finally {
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}

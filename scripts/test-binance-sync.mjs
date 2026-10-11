import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalUrl = process.env.TEST_DATABASE_URL;
if (!originalUrl || new URL(originalUrl).hostname !== "postgres") throw new Error("Run only on the Docker postgres service");
const schema = `binance_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^binance_test_[a-f0-9]{32}$/);
const url = new URL(originalUrl); url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.href;
const live = process.argv.includes("--live");
if (!live) {
  process.env.BINANCE_AFFILIATE_API_KEY = "fake-binance-key";
  process.env.BINANCE_AFFILIATE_API_SECRET = "fake-binance-secret";
}
const { PrismaClient } = await import("../packages/db/dist/generated/client/index.js");
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
let db;
try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const require = createRequire(path.join(root, "packages/db/package.json"));
  try {
    await promisify(execFile)(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.join(root, "packages/db"), env: process.env, timeout: 180000, maxBuffer: 8 * 1024 * 1024
    });
  } catch { throw new Error("Docker test schema migration failed"); }
  ({ db } = await import("../packages/db/dist/index.js"));
  const core = await import("../packages/core/dist/index.js");
  const exchange = await db.exchange.create({ data: { slug: "binance", name: "Binance", status: "PUBLISHED" } });
  const today = new Date().toISOString().slice(0, 10);
  let rows = [];
  const fake = async (url) => {
    const endpoint = new URL(url).pathname;
    const body = endpoint.endsWith("/time") ? { serverTime: Date.now() } : endpoint.endsWith("apiRestrictions")
      ? { enableReading: true, ipRestrict: false, enableWithdrawals: false } : rows;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const fetchImpl = live ? fetch : fake;
  await core.refreshBinanceReadiness(fetchImpl);
  assert.equal((await core.listSyncExchanges())[0].apiSupported, true);
  assert.equal((await core.getSyncConfig(exchange.id)).readiness.ready, true);
  assert.equal((await db.exchangeSyncConfig.findUniqueOrThrow({ where: { exchangeId: exchange.id } })).backfillDays, 0);
  async function cycle() {
    await core.requestSync("test-admin", exchange.id, "MANUAL", [today]);
    const job = await core.claimNextJob(120, "binance-test"); assert.equal(job.type, "SYNC");
    await core.runSyncJob({ id: job.id, lockedBy: job.lockedBy }, job.payload, fetchImpl);
    assert.equal((await db.job.findUniqueOrThrow({ where: { id: job.id } })).state, "DONE");
    const transform = await core.claimNextJob(120, "binance-test"); assert.equal(transform.type, "TRANSFORM");
    await core.transformApiJob({ id: transform.id, lockedBy: transform.lockedBy }, transform.payload.loadId);
    const view = await core.getSyncConfig(exchange.id);
    assert.equal(view.runs[0].state, "SUCCEEDED");
    assert.equal(view.coverage.days, 1);
    return view;
  }
  const empty = await cycle();
  if (!live) {
    assert.equal(empty.runs[0].fetchedRows, 0);
    rows = [{ customerId: "custom-001", income: "0.000000000001", email: "private@example.com", unknown: "private" }];
    const populated = await cycle();
    assert.equal(populated.runs[0].fetchedRows, 2);
    const current = await db.rawLoad.findFirstOrThrow({ where: { state: "TRANSFORMED" } });
    const raw = await core.readRawRows(current.id);
    assert.equal(raw.length, 2);
    assert.equal(raw[0].income, "0.000000000001");
    assert.equal(JSON.stringify(raw).includes("private"), false);
    assert.equal(await db.rawLoad.count({ where: { state: "SUPERSEDED" } }), 1);
    await assert.rejects(core.requestSync("test-admin", exchange.id, "MANUAL", ["2020-01-01"]), error => error.code === "BINANCE_RANGE");
    await core.updateSyncConfig("test-admin", exchange.id, { enabled: true });
    assert.equal(await db.job.count({ where: { payload: { path: ["trigger"], equals: "BACKFILL" } } }), 0);
    await db.job.deleteMany({ where: { state: "PENDING" } });
    await core.scheduleDueSyncs();
    assert.equal(await db.job.count({ where: { payload: { path: ["trigger"], equals: "RECONCILE" } } }), 0);
    process.env.BINANCE_AFFILIATE_API_KEY = "rotated-key";
    await core.refreshBinanceReadiness(fake);
    assert.equal((await core.getSyncConfig(exchange.id)).coverage.days, 0);
  }
  assert.equal(await db.activityMetricCurrent.count(), 0);
  assert.equal(await db.activityRoster.count(), 0);
  assert.equal(await db.commissionRecord.count(), 0);
  assert.equal(await db.wallet.count(), 0);
  assert.equal(await db.walletEntry.count(), 0);
  console.log(JSON.stringify({ passed: true, mode: live ? "LIVE_GET_DOCKER" : "FIXTURE_GET_DOCKER", fetchedRows: empty.runs[0].fetchedRows, walletWrites: 0 }));
} finally {
  if (db) await db.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}

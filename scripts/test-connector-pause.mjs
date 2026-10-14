import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const originalUrl = process.env.TEST_DATABASE_URL;
assert.ok(originalUrl, "TEST_DATABASE_URL is required; no DATABASE_URL fallback");
assert.equal(new URL(originalUrl).hostname, "postgres", "Run only inside the Docker stack");
const schema = `cashback_pause_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^cashback_pause_[a-f0-9]{32}$/);
const url = new URL(originalUrl); url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.href;
const { PrismaClient } = await import("../packages/db/dist/generated/client/index.js");
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
let db, server;
try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const requireDb = createRequire(path.join(root, "packages/db/package.json"));
  await promisify(execFile)(process.execPath, [requireDb.resolve("prisma/build/index.js"), "migrate", "deploy"], { cwd: path.join(root, "packages/db"), env: process.env, timeout: 120000 });
  ({ db } = await import("../packages/db/dist/index.js"));
  const core = await import("../packages/core/dist/index.js");
  const exchanges = {};
  for (const slug of ["bybit", "mexc", "binance"]) {
    exchanges[slug] = await db.exchange.create({ data: { slug, name: slug.toUpperCase(), status: "PUBLISHED" } });
    await db.exchangeSyncConfig.create({ data: { exchangeId: exchanges[slug].id, rootAccount: "fixture-root", enabled: true, intervalMinutes: slug === "bybit" ? 60 : 30, nextRunAt: new Date(Date.now() - 60000), backfillDays: 0 } });
  }
  const admin = await db.adminAccount.create({ data: { email: "pause-admin@test.invalid" } });
  const token = await core.createSession(admin.id);
  const { sessionCookieName } = await import("../apps/web/src/lib/session-cookie.ts");
  const probe = createServer(); await new Promise(done => probe.listen(0, "127.0.0.1", done));
  const port = probe.address().port; await new Promise(done => probe.close(done));
  const origin = `http://127.0.0.1:${port}`;
  const requireWeb = createRequire(path.join(root, "apps/web/package.json"));
  server = spawn(process.execPath, [requireWeb.resolve("next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], { cwd: path.join(root, "apps/web"), env: { ...process.env, APP_URL: origin, NODE_ENV: "production" }, stdio: "ignore" });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) { try { if ((await fetch(`${origin}/api/health`)).ok) { ready = true; break; } } catch {} await new Promise(done => setTimeout(done, 250)); }
  assert.ok(ready, "Isolated test web did not become ready");
  const endpoint = `/api/admin/ingest/connectors/${exchanges.bybit.id}`;
  const request = (pathname, options = {}, authenticated = true) => fetch(`${origin}${pathname}`, { ...options, headers: { Origin: origin, ...(authenticated ? { Cookie: `${sessionCookieName}=${token}` } : {}), ...options.headers } });
  assert.equal((await request(`${endpoint}/pause`, { method: "POST" }, false)).status, 401);
  assert.equal((await request(`${endpoint}/pause`, { method: "POST", headers: { Origin: "https://invalid.test" } })).status, 403);
  let result = await request(`${endpoint}/pause`, { method: "POST" }); assert.equal(result.status, 200);
  let view = await result.json(); assert.equal(view.adminPaused, true); assert.equal(view.enabled, true); assert.equal(view.intervalMinutes, 60);
  assert.match(result.headers.get("cache-control"), /no-store/);
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchanges.mexc.id } })).adminPaused, false);
  result = await request(endpoint, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intervalMinutes: 720 }) }); assert.equal(result.status, 200);
  assert.equal((await result.json()).adminPaused, true, "Saving interval must not resume");
  result = await request(`${endpoint}/resume`, { method: "POST" }); assert.equal(result.status, 200); view = await result.json();
  assert.equal(view.adminPaused, false); assert.equal(view.enabled, true); assert.equal(view.intervalMinutes, 720);
  result = await request(`/api/admin/sync-config/${exchanges.bybit.id}/pause`, { method: "POST" }); assert.equal(result.status, 200); assert.equal((await result.json()).adminPaused, true);
  const audit = await db.syncConfigAudit.findFirst({ where: { exchangeId: exchanges.bybit.id, action: "PAUSE" } }); assert.equal(audit.adminId, admin.id);
  console.log("PASS pause/resume API, auth/CSRF, legacy alias, saved settings and exchange isolation");

  const dates = [new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10), new Date(Date.now() - 86400000).toISOString().slice(0, 10)];
  for (const trigger of ["MANUAL", "RESYNC"]) await assert.rejects(() => core.requestSync(admin.id, exchanges.bybit.id, trigger, dates), error => error.code === "ADMIN_PAUSED");
  const scheduledAt = new Date(Date.now() + 86400000);
  await core.scheduleDueSyncs(scheduledAt);
  assert.equal(await db.job.count({ where: { type: "SYNC", payload: { path: ["exchangeId"], equals: exchanges.bybit.id } } }), 0);
  assert.ok(await db.job.count({ where: { type: "SYNC", payload: { path: ["exchangeId"], equals: exchanges.mexc.id } } }));
  let calls = 0;
  for (const trigger of ["MANUAL", "RESYNC", "SCHEDULED", "BACKFILL", "RECONCILE"]) {
    const job = await db.job.create({ data: { type: "SYNC", state: "CLAIMED", lockedBy: "pause-fixture", leaseUntil: new Date(Date.now() + 120000), payload: { exchangeId: exchanges.bybit.id, trigger, dates } } });
    await core.runSyncJob({ id: job.id, lockedBy: job.lockedBy }, job.payload, async () => { calls++; throw new Error("Paused job must not fetch"); });
    assert.equal((await db.job.findUnique({ where: { id: job.id } })).state, "DONE");
  }
  assert.equal(calls, 0); console.log("PASS scheduler/manual/resync/queued-job pause guards; zero exchange requests");

  Object.assign(process.env, { BYBIT_AFFILIATE_API_KEY: "fixture-key", BYBIT_AFFILIATE_API_SECRET: "fixture-secret", BYBIT_AFFILIATE_MASTER_UID: "fixture-root" });
  const keyResponse = () => new Response(JSON.stringify({ retCode: 0, result: { readOnly: 1, permissions: { Affiliate: ["Affiliate"] }, ips: ["*"], expiredAt: "2099-01-01T00:00:00Z" } }), { headers: { "Content-Type": "application/json" } });
  await core.refreshBybitReadiness(async () => keyResponse());
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchanges.bybit.id } })).adminPaused, true);
  await db.exchangeSyncConfig.update({ where: { exchangeId: exchanges.bybit.id }, data: { enabled: false, pausedReason: "SCHEMA_DRIFT" } });
  await core.updateSyncConfig(admin.id, exchanges.bybit.id, { enabled: true });
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchanges.bybit.id } })).pausedReason, "SCHEMA_DRIFT", "Saving settings while admin-paused must preserve the error pause too");
  assert.equal(await db.job.count({ where: { type: "SYNC", state: "PENDING", payload: { path: ["exchangeId"], equals: exchanges.bybit.id } } }), 0, "Enabling while paused must not queue work");
  await core.pauseSync(admin.id, exchanges.binance.id);
  Object.assign(process.env, { BINANCE_AFFILIATE_API_KEY: "fixture-rotated-key", BINANCE_AFFILIATE_API_SECRET: "fixture-secret" });
  await core.refreshBinanceReadiness(async () => new Response("{}", { headers: { "Content-Type": "application/json" } }));
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchanges.binance.id } })).adminPaused, true);
  console.log("PASS readiness, key rotation and enabling do not clear admin pause");

  await db.exchangeSyncConfig.update({ where: { exchangeId: exchanges.bybit.id }, data: { pausedReason: "SCHEMA_DRIFT", readinessReady: false, readinessReason: "NOT_READY" } });
  view = await core.resumeSync(admin.id, exchanges.bybit.id); assert.equal(view.adminPaused, false); assert.equal(view.pausedReason, "SCHEMA_DRIFT");
  await assert.rejects(() => core.resumeSync(admin.id, exchanges.bybit.id), error => error.code === "NOT_READY");
  await db.exchangeSyncConfig.update({ where: { exchangeId: exchanges.bybit.id }, data: { readinessReady: true, readinessReason: null } });
  view = await core.resumeSync(admin.id, exchanges.bybit.id); assert.equal(view.pausedReason, null);
  await db.$executeRawUnsafe('ALTER TABLE "SyncConfigAudit" ADD CONSTRAINT "pause_audit_fixture" CHECK ("adminId" <> \'reject-admin\')');
  await assert.rejects(() => core.pauseSync("reject-admin", exchanges.bybit.id));
  assert.equal((await db.exchangeSyncConfig.findUnique({ where: { exchangeId: exchanges.bybit.id } })).adminPaused, false, "Failed audit must roll back pause");
  console.log("PASS unresolved error preservation, readiness recovery and atomic audit rollback");

  let dayCalls = 0;
  const fakeFetch = async input => {
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith("/query-api")) return keyResponse();
    assert.ok(pathname.endsWith("/aff-user-list"), "Unexpected fixture endpoint");
    dayCalls++;
    await core.pauseSync(admin.id, exchanges.bybit.id);
    return new Response(JSON.stringify({ retCode: 0, result: { list: [{ userId: "00123", source: "fixture", tradeVol: "10", takerVol: "4", makerVol: "6", tradfiTradeVol: "", commissionsVol: { USDT: "1" }, volUpdateTime: "" }], nextPageCursor: "" } }), { headers: { "Content-Type": "application/json" } });
  };
  const running = await db.job.create({ data: { type: "SYNC", state: "CLAIMED", lockedBy: "pause-fixture", leaseUntil: new Date(Date.now() + 120000), payload: { exchangeId: exchanges.bybit.id, trigger: "MANUAL", dates } } });
  await core.runSyncJob({ id: running.id, lockedBy: running.lockedBy }, running.payload, fakeFetch);
  assert.equal(dayCalls, 1, "Pause stops before the second day");
  const stopped = await db.syncRun.findFirst({ where: { exchangeId: exchanges.bybit.id }, orderBy: { createdAt: "desc" } });
  assert.equal(stopped.state, "PAUSED"); assert.equal(stopped.safeErrorCode, "ADMIN_PAUSED");
  assert.equal((await db.job.findUnique({ where: { id: running.id } })).state, "DONE");
  assert.equal(await db.commissionRecord.count(), 0); assert.equal(await db.walletEntry.count(), 0);
  console.log("PASS pause between days; current raw slice can finish; no commission/wallet effects");
} finally {
  if (server && server.exitCode === null) { server.kill(); await new Promise(done => server.once("exit", done)); }
  await db?.$disconnect();
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  assert.equal((await control.$queryRawUnsafe('SELECT count(*)::int AS count FROM information_schema.schemata WHERE schema_name = $1', schema))[0].count, 0);
  await control.$disconnect();
  console.log("PASS isolated schema cleaned; main localhost kept running");
}

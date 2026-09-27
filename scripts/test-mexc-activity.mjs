import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import dotenv from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env"), quiet: true });
const originalUrl = process.env.TEST_DATABASE_URL;
if (!originalUrl) throw new Error("Set TEST_DATABASE_URL explicitly to a dedicated test database for integration tests");
const schema = `cashback_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^cashback_test_[a-f0-9]{32}$/);
const url = new URL(originalUrl);
url.searchParams.set("schema", schema);
process.env.DATABASE_URL = url.href;
const { PrismaClient } = await import("../packages/db/dist/generated/client/index.js");
const control = new PrismaClient({ datasources: { db: { url: originalUrl } } });
const require = createRequire(path.join(root, "packages/core/package.json"));
const ExcelJS = require("exceljs");

async function xlsx(sheetName, rows, headers = ["Referral", "Trading volume", "Trading token", "Your Earnings", "Commission token", "Referral Code", "Nickname"]) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(sheetName);
  headers.forEach((header, index) => { sheet.getRow(1).getCell(index + 1).value = header; });
  rows.forEach((values, rowIndex) => values.forEach((value, index) => { sheet.getRow(rowIndex + 2).getCell(index + 1).value = String(value); }));
  return Buffer.from(await book.xlsx.writeBuffer());
}

try {
  await control.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const dbRequire = createRequire(path.join(root, "packages/db/package.json"));
  const migrated = await new Promise((resolve, reject) => {
    execFile(process.execPath, [dbRequire.resolve("prisma/build/index.js"), "migrate", "deploy"], {
      cwd: path.join(root, "packages/db"), env: process.env, timeout: 180000, maxBuffer: 8 * 1024 * 1024
    }, (error, stdout, stderr) => error ? reject(Object.assign(error, { stdout, stderr })) : resolve({ stdout, stderr }));
  }).catch((error) => ({ stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message ?? ""), failed: true }));
  const migrateOk = !migrated.failed || migrated.stdout.includes("applied") || migrated.stdout.includes("No pending migrations");
  if (!migrateOk) throw new Error(`Migration failed in isolated schema: ${migrated.stderr.replaceAll(originalUrl, "[database]")}`);
  const { db } = await import("../packages/db/dist/index.js");
  const core = await import("../packages/core/dist/index.js");
  const { inclusivePeriodUtc } = await import("../packages/contracts/dist/index.js");
  const exchange = await db.exchange.create({ data: { slug: "mexc", name: "MEXC", status: "PUBLISHED", defaultCashbackRate: "0.35" } });
  const before = {
    commission: await db.commissionRecord.count(),
    wallet: await db.wallet.count(),
    entry: await db.walletEntry.count()
  };
  async function runNext(expected) {
    const job = await core.claimNextJob(120, "mexc-test");
    assert(job && job.lockedBy);
    if (expected) assert.equal(job.type, expected);
    const lease = { id: job.id, lockedBy: job.lockedBy };
    if (job.type === "LOAD") await core.parseImportJob(lease, job.payload.batchId);
    else if (job.type === "TRANSFORM") await core.transformImportJob(lease, job.payload.loadId);
    else if (job.type === "PUBLISH") await core.publishImportJob(lease, job.payload.batchId);
    else throw new Error(`Unexpected job ${job.type}`);
    assert.equal((await db.job.findUnique({ where: { id: job.id } })).state, "DONE");
  }
  async function upload(sheetName, rows, metadata) {
    const result = await core.createImportBatch(metadata, { bytes: await xlsx(sheetName, rows), extension: "xlsx" });
    await runNext("LOAD");
    await runNext("TRANSFORM");
    return result.batchId;
  }
  function meta(start, end, sourceAsOf) {
    return { exchangeId: exchange.id, rootAccount: "mexc-root", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", sourceTz: "UTC", sourceAsOf, ...inclusivePeriodUtc(start, end, "UTC") };
  }
  const first = await upload("_2026-09-01~2026-09-07", [
    ["00123", "0", "USDT", "0", "USDT", "fixture-code", "Do Not Store"],
    ["00456", "0", "USDT", "0", "USDT", "fixture-code", "Also Hidden"]
  ], meta("2026-09-01", "2026-09-07", "2026-09-07T10:00:00.000Z"));
  const firstPreview = await core.getImportPreview(first);
  const pinned = await db.importBatch.findUniqueOrThrow({ where: { id: first } });
  assert.equal(pinned.adapterId, "mexc-referral-xlsx");
  assert.equal(pinned.contractVersion, "mexc-referral-xlsx@1");
  assert.equal(firstPreview.preview.totalRows, 2);
  assert.equal(firstPreview.preview.flaggedRows, 0);
  assert.equal(firstPreview.batch.affectsCashback, false);
  assert.equal(firstPreview.batch.totals.partial, true);
  assert.equal(firstPreview.rawLoad.state, "TRANSFORMED");
  assert.equal((await core.readRawRows(firstPreview.rawLoad.id)).length, 2);
  assert.equal(JSON.stringify(await core.readRawRows(firstPreview.rawLoad.id)).includes("Do Not Store"), false);
  assert.equal(JSON.stringify(firstPreview).includes("Do Not Store"), false);
  const staged = await db.stagingRow.findMany({ where: { batchId: first } });
  assert.equal(JSON.stringify(staged).includes("Do Not Store"), false);
  assert.equal(JSON.stringify(staged).includes("Also Hidden"), false);
  const older = await upload("_2026-09-01~2026-09-07", [
    ["00123", "9", "USDT", "1", "USDT", "fixture-code", "Hidden"]
  ], meta("2026-09-01", "2026-09-07", "2026-09-06T10:00:00.000Z"));
  await core.commitImportBatch(first);
  await runNext("PUBLISH");
  assert.equal(await db.job.count({ where: { type: "ATTRIBUTE" } }), 0);
  let current = await core.listReferralSnapshots({ ...inclusivePeriodUtc("2026-09-01", "2026-09-07", "UTC"), exchangeId: exchange.id });
  assert.deepEqual(current.snapshots.map((row) => row.uid).sort(), ["00123", "00456"]);
  assert.ok(current.snapshots.every((row) => row.tradingVolume === "0.0000000000" && row.reportedEarnings === "0.0000000000" && row.partial));
  const newer = await upload("_2026-09-01~2026-09-07", [
    ["00123", "5", "USDT", "1.5", "USDT", "fixture-code", "Still Hidden"]
  ], meta("2026-09-01", "2026-09-07", "2026-09-07T18:00:00.000Z"));
  assert.equal((await core.readRawRows(firstPreview.rawLoad.id)).length, 0, "new load replaces raw rows of its exact slice");
  await core.commitImportBatch(newer);
  await runNext("PUBLISH");
  current = await core.listReferralSnapshots({ ...inclusivePeriodUtc("2026-09-01", "2026-09-07", "UTC"), exchangeId: exchange.id });
  assert.equal(current.snapshots.length, 1);
  assert.equal(current.snapshots[0].uid, "00123");
  assert.equal(current.snapshots[0].tradingVolume, "5.0000000000");
  assert.equal(current.snapshots[0].reportedEarnings, "1.5000000000");
  assert.equal(await db.referralSnapshot.count({ where: { uid: "00456", current: true } }), 0);
  assert.equal(await db.referralSnapshot.count({ where: { uid: "00456", current: false } }), 1);
  await core.commitImportBatch(older);
  const olderJob = await core.claimNextJob(120, "mexc-older");
  assert.equal(olderJob.type, "PUBLISH");
  await assert.rejects(() => core.publishImportJob({ id: olderJob.id, lockedBy: olderJob.lockedBy }, older), /OLDER_REPORT/);
  await core.failJob({ id: olderJob.id, lockedBy: olderJob.lockedBy }, 5, new Error("OLDER_REPORT"));
  assert.equal((await core.getImportPreview(older)).batch.status, "FAILED");
  const stale = await upload("_2026-09-01~2026-09-07", [
    ["00123", "9", "USDT", "1", "USDT", "fixture-code", "Hidden"]
  ], meta("2026-09-01", "2026-09-07", "2026-09-05T10:00:00.000Z"));
  const stalePreview = await core.getImportPreview(stale);
  assert.equal(stalePreview.preview.flaggedRows, 1);
  assert.match(JSON.stringify(stalePreview.preview.rows), /OLDER_REPORT/);
  await assert.rejects(() => core.commitImportBatch(stale), /flagged/);
  const overlap = await upload("_2026-09-05~2026-09-10", [
    ["00789", "0", "USDT", "0", "USDT", "fixture-code", "Hidden"]
  ], meta("2026-09-05", "2026-09-10", "2026-09-11T00:00:00.000Z"));
  const overlapPreview = await core.getImportPreview(overlap);
  assert.equal(overlapPreview.batch.totals.partial, false);
  assert.equal((await core.readRawRows(overlapPreview.rawLoad.id)).length, 1, "another period keeps its raw rows");
  await core.commitImportBatch(overlap);
  await runNext("PUBLISH");
  const firstPeriod = await core.listReferralSnapshots({ ...inclusivePeriodUtc("2026-09-01", "2026-09-07", "UTC"), exchangeId: exchange.id });
  const secondPeriod = await core.listReferralSnapshots({ ...inclusivePeriodUtc("2026-09-05", "2026-09-10", "UTC"), exchangeId: exchange.id });
  assert.deepEqual(firstPeriod.snapshots.map((row) => row.uid), ["00123"]);
  assert.deepEqual(secondPeriod.snapshots.map((row) => row.uid), ["00789"]);
  assert.equal(secondPeriod.snapshots[0].tradingVolume, "0.0000000000");
  assert.equal(firstPeriod.snapshots.some((row) => row.uid === "00789"), false);
  assert.equal(await db.commissionRecord.count(), before.commission);
  assert.equal(await db.wallet.count(), before.wallet);
  assert.equal(await db.walletEntry.count(), before.entry);
  assert.equal(await db.job.count({ where: { type: "ATTRIBUTE" } }), 0);
  const stalePeriod = meta("2026-08-01", "2026-08-07", "2026-08-08T00:00:00.000Z");
  const staleBatch = await db.importBatch.create({ data: { ...stalePeriod, datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", fileRef: "db:stale/original.xlsx", adapterId: "mexc-referral-xlsx", contractVersion: "mexc-referral-xlsx@1" } });
  const rawInput = { exchangeId: exchange.id, sourceSystem: "mexc", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", rootAccount: "mexc-root", periodStart: new Date(stalePeriod.periodStart), periodEnd: new Date(stalePeriod.periodEnd), batchId: staleBatch.id,
    fieldNames: ["Referral", "Trading volume", "Trading token", "Your Earnings", "Commission token"], sourceMetadata: { sheetName: "_2026-08-01~2026-08-07" } };
  const staleLoad = await core.writeRawLoad({ ...rawInput, records: [{ Referral: "999", "Trading volume": "1", "Trading token": "USDT", "Your Earnings": "0", "Commission token": "USDT" }] });
  await core.writeRawLoad({ ...rawInput, records: [{ Referral: "999", "Trading volume": "2", "Trading token": "USDT", "Your Earnings": "0", "Commission token": "USDT" }] });
  const staleJob = await core.claimNextJob(120, "stale-test");
  assert.equal(staleJob.type, "TRANSFORM");
  await core.transformImportJob({ id: staleJob.id, lockedBy: staleJob.lockedBy }, staleJob.payload.loadId);
  assert.equal((await db.rawLoad.findUniqueOrThrow({ where: { id: staleLoad.id } })).state, "SUPERSEDED");
  assert.equal(await db.stagingRow.count({ where: { batchId: staleBatch.id } }), 0, "superseded transform writes nothing");
  const repairMeta = meta("2026-07-01", "2026-07-07", "2026-07-08T00:00:00.000Z");
  const repair = await core.createImportBatch(repairMeta, { extension: "xlsx", bytes: await xlsx("_2026-07-01~2026-07-07",
    [["00888", "4", "USDT", "1", "USDT", "code", "Secret"]],
    ["Referral", "Renamed volume", "Trading token", "Your Earnings", "Commission token", "Referral Code", "Nickname"]) });
  await runNext("TRANSFORM"); // current load from the stale-transform guard above
  await runNext("LOAD");
  const repairRaw = await db.rawLoad.findFirstOrThrow({ where: { batchId: repair.batchId } });
  assert.equal(repairRaw.state, "LOADED", "renamed source column does not fail LOAD");
  await runNext("TRANSFORM");
  assert.equal((await db.rawLoad.findUniqueOrThrow({ where: { id: repairRaw.id } })).safeErrorCode, "BREAKING");
  assert.equal((await core.readRawRows(repairRaw.id)).length, 1);
  const field = core.mexcReferralContract.fields.find((item) => item.source === "Trading volume");
  const aliases = field.aliases;
  try {
    field.aliases = ["Renamed volume"];
    await core.requestRetransform("test-admin", repairRaw.id);
    await runNext("TRANSFORM");
    assert.equal((await core.getImportPreview(repair.batchId)).batch.status, "PREVIEW");
    assert.equal((await db.rawTransformAudit.count({ where: { loadId: repairRaw.id } })), 1);
  } finally { field.aliases = aliases; }
  const otherExchange = await db.exchange.create({ data: { slug: "newexchange", name: "New Exchange", status: "PUBLISHED" } });
  const defaultLoad = await core.writeRawLoad({ ...rawInput, exchangeId: otherExchange.id, sourceSystem: "newexchange", batchId: undefined,
    records: [{ Referral: "1", "Trading volume": "0", "Trading token": "USDT", "Your Earnings": "0", "Commission token": "USDT" }] });
  const partition = await db.$queryRaw`SELECT tableoid::regclass::text AS name FROM raw_record WHERE _load_id = ${defaultLoad.id}`;
  assert.match(partition[0].name, /raw_default$/, "new exchange lands in the default partition");
  await db.rawLoad.update({ where: { id: defaultLoad.id }, data: { state: "TRANSFORMED", transformedAt: new Date(Date.now() - 31 * 86_400_000) } });
  await core.purgeTransformedRaw();
  assert.equal((await core.readRawRows(defaultLoad.id)).length, 0, "30-day retention removes raw rows but keeps load metadata");
  assert.ok(await db.rawLoad.findUnique({ where: { id: defaultLoad.id } }));
  console.log("PASS: MEXC activity versions snapshots without touching commission or wallets");
} finally {
  await control.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.$disconnect();
}

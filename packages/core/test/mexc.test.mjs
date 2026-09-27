import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inclusivePeriodUtc } from "@cashback/contracts";
import { mexcReferralContract, parseMexcReferralXlsx, readRawXlsx } from "../dist/index.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/mexc-referral-activity.xlsx");
const samplePath = path.join(root, "data/mexc/Referral Data Export-2026-09-25 14_22_39.xlsx");
const allowedRaw = new Set(["sourceRow", "Referral", "Trading volume", "Trading token", "Your Earnings", "Commission token", "Referral Code"]);

function utcBatch(sourceAsOf = "2026-09-25T14:22:39.000Z") {
  const period = inclusivePeriodUtc("2026-09-18", "2026-09-25", "UTC");
  return { sourceTz: "UTC", sourceAsOf: new Date(sourceAsOf), periodStart: new Date(period.periodStart), periodEnd: new Date(period.periodEnd) };
}

async function workbook(setup) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("_2026-09-18~2026-09-25");
  await setup(sheet);
  return book.xlsx.writeBuffer();
}
function textRow(sheet, values) {
  const row = sheet.addRow(values);
  row.eachCell((cell) => { cell.value = String(cell.value ?? ""); });
  return row;
}

test("synthetic MEXC fixture keeps leading zeroes, warns on extra columns and hides personal cells", async () => {
  const parsed = await parseMexcReferralXlsx(readFileSync(fixturePath), utcBatch());
  assert.equal(parsed.partial, true);
  assert.equal(parsed.rows.length, 2);
  assert.deepEqual(parsed.rows[0].flags, []);
  assert.equal(parsed.rows[0].normalized.uid, "00123456");
  assert.equal(parsed.rows[0].normalized.tradingVolume, "0.0000000000");
  assert.equal(parsed.rows[0].normalized.reportedEarnings, "0.0000000000");
  assert.equal(parsed.rows[0].normalized.referralCode, "fixture-code");
  assert.ok(parsed.warnings.includes("Extra column: Nickname"));
  assert.ok(parsed.warnings.includes("Extra column: Prediction Markets Fee-Sharing Rate"));
  for (const row of parsed.rows) {
    for (const key of Object.keys(row.raw)) assert.ok(allowedRaw.has(key), key);
    assert.equal(JSON.stringify(row.raw).includes("Do Not Store"), false);
  }
});

test("missing headers, formulas, duplicate UIDs, bad amounts and period mismatch are rejected", async () => {
  const headers = ["Referral", "Trading volume", "Trading token", "Your Earnings", "Commission token", "Referral Code"];
  const missing = await workbook((sheet) => { textRow(sheet, ["Referral", "Trading volume", "Trading token", "Commission token"]); textRow(sheet, ["001", "0", "USDT", "USDT"]); });
  await assert.rejects(() => parseMexcReferralXlsx(missing, utcBatch()), /Missing required header: Your Earnings/);
  const formula = await workbook((sheet) => {
    textRow(sheet, headers);
    const row = textRow(sheet, ["001", "0", "USDT", "0", "USDT", "fixture-code"]);
    row.getCell(2).value = { formula: "1+1", result: 2 };
  });
  await assert.rejects(() => parseMexcReferralXlsx(formula, utcBatch()), /formula/i);
  await assert.rejects(() => readRawXlsx(formula, mexcReferralContract), /formula/i);
  const duplicate = await workbook((sheet) => {
    textRow(sheet, headers);
    textRow(sheet, ["00123", "1", "USDT", "0.5", "USDT", "fixture-code"]);
    textRow(sheet, ["00123", "2", "USDT", "0.5", "USDT", "fixture-code"]);
  });
  const duplicated = await parseMexcReferralXlsx(duplicate, utcBatch());
  assert.equal(duplicated.rows.length, 2);
  assert.ok(duplicated.rows.every((row) => row.flags.includes("DUPLICATE_UID") && row.normalized === null));
  const invalid = await workbook((sheet) => {
    textRow(sheet, headers);
    textRow(sheet, ["00123", "-1", "USDT", "nope", "BTC-USDT", "fixture-code"]);
  });
  const rejected = await parseMexcReferralXlsx(invalid, utcBatch());
  assert.ok(rejected.rows[0].flags.includes("INVALID_VOLUME"));
  assert.ok(rejected.rows[0].flags.includes("INVALID_EARNINGS"));
  assert.ok(rejected.rows[0].flags.includes("INVALID_ASSET"));
  await assert.rejects(() => parseMexcReferralXlsx(duplicate, { ...utcBatch(), periodEnd: new Date("2026-09-26T23:59:59.999Z") }), /Sheet period does not match/);
});

test("a workbook that declares more than 50 MiB uncompressed is refused before parsing", async () => {
  const payload = Buffer.from("tiny");
  const name = Buffer.from("xl/worksheets/sheet1.xml");
  const local = Buffer.alloc(30 + name.length + payload.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  payload.copy(local, 30 + name.length);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(60 * 1024 * 1024, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length, 16);
  const archive = Buffer.concat([local, central, eocd]);
  await assert.rejects(() => parseMexcReferralXlsx(archive, utcBatch()), /50 MiB/);
  await assert.rejects(() => readRawXlsx(archive, mexcReferralContract), /50 MiB/);
});

test("local MEXC Referral Data sample previews 46 zero rows and is partial", async (t) => {
  if (!existsSync(samplePath)) return t.skip("private MEXC sample is not in this checkout");
  const parsed = await parseMexcReferralXlsx(readFileSync(samplePath), utcBatch("2026-09-25T14:22:39.000Z"));
  assert.equal(parsed.rows.length, 46);
  assert.equal(parsed.partial, true);
  assert.equal(new Set(parsed.rows.map((row) => row.normalized?.uid)).size, 46);
  for (const row of parsed.rows) {
    assert.deepEqual(row.flags, []);
    assert.equal(row.normalized.tradingVolume, "0.0000000000");
    assert.equal(row.normalized.reportedEarnings, "0.0000000000");
    assert.equal(row.normalized.tradingAsset, "USDT");
    assert.equal(row.normalized.earningsAsset, "USDT");
    for (const key of Object.keys(row.raw)) assert.ok(allowedRaw.has(key), key);
  }
  assert.ok(parsed.warnings.some((warning) => warning.includes("Prediction Markets Fee-Sharing Rate")));
});

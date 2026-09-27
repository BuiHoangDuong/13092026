import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { bybitCsvContract, mexcReferralContract, parseMexcRecords, readRawCsv, readRawXlsx } from "../dist/index.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const period = { sourceTz: "UTC", sourceAsOf: new Date("2026-09-08T00:00:00.000Z"), periodStart: new Date("2026-09-01T00:00:00.000Z"), periodEnd: new Date("2026-09-07T23:59:59.999Z") };

async function workbook(headers, values) {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("_2026-09-01~2026-09-07");
  sheet.addRow(headers);
  sheet.addRow(values);
  return Buffer.from(await book.xlsx.writeBuffer());
}

test("LOAD stores renamed headers and drops personal fields; a declared alias repairs TRANSFORM", async () => {
  const field = mexcReferralContract.fields.find((item) => item.source === "Trading volume");
  const originalAliases = field.aliases;
  const raw = await readRawXlsx(await workbook(
    ["Referral", "Volume renamed", "Trading token", "Your Earnings", "Commission token", "Nickname"],
    ["00123", "5", "USDT", "1", "USDT", "Secret nickname"]
  ), mexcReferralContract);
  assert.equal(raw.records.length, 1);
  assert.equal(raw.records[0]["Volume renamed"], "5");
  assert.equal("Nickname" in raw.records[0], false);
  assert.throws(() => parseMexcRecords(raw.records, period, raw.sourceMetadata.sheetName), /BREAKING/);
  try {
    field.aliases = ["Volume renamed"];
    const result = parseMexcRecords(raw.records, period, raw.sourceMetadata.sheetName);
    assert.equal(result.rows[0].normalized.tradingVolume, "5.0000000000");
    assert.equal(result.driftReport.class, "ALIASED");
  } finally { field.aliases = originalAliases; }
});

test("LOAD retains duplicate and empty header positions for later drift assessment", () => {
  const raw = readRawCsv(Buffer.from("uid,asset,commission,asset,\n001,USDT,1,BTC,x\n"), bybitCsvContract);
  assert.deepEqual(raw.fieldNames, ["uid", "asset", "commission", "asset__2", "__col_5"]);
  assert.equal(raw.records[0].asset__2, "BTC");
  assert.equal(raw.records[0].__col_5, "x");
});

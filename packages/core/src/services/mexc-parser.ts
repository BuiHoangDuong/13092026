import { createRequire } from "node:module";
import { inclusivePeriodUtc } from "@cashback/contracts";
import { canonicalizeRecord, classifyHeaders, mexcReferralContract } from "../ingest/contract.js";
import { Prisma } from "@cashback/db";
import type { Cell, Workbook } from "exceljs";
import { assertSafeXlsx } from "./xlsx-safe.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as { Workbook: new () => Workbook; ValueType: { Formula: number } };

const REQUIRED = ["Referral", "Trading volume", "Trading token", "Your Earnings", "Commission token"] as const;
const MAPPED = new Set<string>([...REQUIRED, "Referral Code"]);
const AMOUNT = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/;
const ASSET = /^[A-Z0-9]{1,16}$/;
const UID = /^\d{1,128}$/;
const MAX_ROWS = 5000;
const MAX_COLUMNS = 64;

export type ActivityNormalized = {
  uid: string;
  tradingVolume: string;
  tradingAsset: string;
  reportedEarnings: string;
  earningsAsset: string;
  referralCode: string | null;
};
export type ActivityParsedRow = { raw: Record<string, string | number>; normalized: ActivityNormalized | null; flags: string[] };
export type ActivityParse = { rows: ActivityParsedRow[]; warnings: string[]; partial: boolean; schemaFingerprint?: string; contractVersion?: string; driftReport?: { class: string; fields: string[] } };
type BatchPeriod = { sourceTz: string; sourceAsOf: Date | null; periodStart: Date; periodEnd: Date };

function cellText(cell: Cell): string {
  const value = cell.value;
  if (cell.type === ExcelJS.ValueType.Formula || (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value))) {
    throw new Error("Spreadsheet formulas are not allowed");
  }
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  throw new Error("Only text cells are accepted");
}

function isBlank(cell: Cell) {
  const value = cell.value;
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) return value.richText.every((part) => part.text.trim() === "");
  return false;
}

function sheetPeriod(name: string, batch: BatchPeriod) {
  const match = /^_?(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/.exec(name.trim());
  if (!match?.[1] || !match[2]) throw new Error("Sheet name must be an inclusive period like _2026-09-18~2026-09-25");
  let period: { periodStart: string; periodEnd: string };
  try { period = inclusivePeriodUtc(match[1], match[2], batch.sourceTz); }
  catch (error) { throw new Error(error instanceof Error ? error.message : "Invalid source timezone"); }
  if (new Date(period.periodStart).getTime() !== batch.periodStart.getTime() || new Date(period.periodEnd).getTime() !== batch.periodEnd.getTime()) {
    throw new Error("Sheet period does not match the supplied report period");
  }
}

export function assertMexcUpload(file: { bytes: Uint8Array; extension: string }, batch: { sourceTz: string; sourceAsOf?: string | Date | null }) {
  if (file.extension !== "xlsx") throw new Error("MEXC referral activity accepts one .xlsx worksheet");
  if (!file.bytes.length || file.bytes.length > 10 * 1024 * 1024) throw new Error("XLSX must be between 1 byte and 10 MiB");
  if (file.bytes[0] !== 0x50 || file.bytes[1] !== 0x4b) throw new Error("XLSX archive is not a valid workbook");
  if (!batch.sourceTz.trim()) throw new Error("Referral activity requires a source timezone");
  try { inclusivePeriodUtc("2026-01-01", "2026-01-01", batch.sourceTz); }
  catch { throw new Error("Unknown source timezone"); }
  if (!batch.sourceAsOf || !Number.isFinite(new Date(batch.sourceAsOf).getTime())) throw new Error("Referral activity requires a source as-of time");
  // A future as-of would outrank every later genuine export and block it as OLDER_REPORT.
  if (new Date(batch.sourceAsOf).getTime() > Date.now() + 5 * 60 * 1000) throw new Error("Source as-of time cannot be in the future");
}

/** Native MEXC Referral Data workbook. Reported earnings are not payable commission. */
export async function parseMexcReferralXlsx(bytes: Uint8Array, batch: BatchPeriod): Promise<ActivityParse> {
  if (!batch.sourceTz.trim()) throw new Error("Referral activity requires a source timezone");
  if (!batch.sourceAsOf || !Number.isFinite(batch.sourceAsOf.getTime())) throw new Error("Referral activity requires a source as-of time");
  await assertSafeXlsx(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  if (workbook.worksheets.length !== 1) throw new Error("Workbook must contain exactly one worksheet");
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook must contain exactly one worksheet");
  sheetPeriod(sheet.name, batch);
  if (sheet.columnCount > MAX_COLUMNS || sheet.rowCount > MAX_ROWS + 1) throw new Error("Workbook exceeds the row or column limit");
  const headers = new Map<string, number>();
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    const header = cellText(sheet.getRow(1).getCell(column)).trim();
    if (!header) continue;
    if (headers.has(header)) throw new Error(`Duplicate header: ${header}`);
    headers.set(header, column);
  }
  const missing = REQUIRED.filter((header) => !headers.has(header));
  if (missing.length) throw new Error(`Missing required header: ${missing.join(", ")}`);
  const warnings = [...headers.keys()].filter((header) => !MAPPED.has(header)).map((header) => `Extra column: ${header}`);
  const referralColumn = headers.get("Referral Code");
  const column = (header: string) => {
    const index = headers.get(header);
    if (!index) throw new Error(`Missing required header: ${header}`);
    return index;
  };
  const drafts: ActivityParsedRow[] = [];
  const uids = new Map<string, number>();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    // Unmapped columns are discarded, so only test them for blankness; strict text parsing applies to mapped cells.
    if ([...headers.values()].every((index) => isBlank(row.getCell(index)))) continue;
    const flags: string[] = [];
    const uid = cellText(row.getCell(column("Referral"))).trim();
    const volume = cellText(row.getCell(column("Trading volume"))).trim();
    const tradingToken = cellText(row.getCell(column("Trading token"))).trim();
    const earnings = cellText(row.getCell(column("Your Earnings"))).trim();
    const earningsToken = cellText(row.getCell(column("Commission token"))).trim();
    const referralCode = referralColumn ? cellText(row.getCell(referralColumn)).trim() : "";
    if (!UID.test(uid)) flags.push("INVALID_UID");
    if (!AMOUNT.test(volume)) flags.push("INVALID_VOLUME");
    if (!AMOUNT.test(earnings)) flags.push("INVALID_EARNINGS");
    if (!ASSET.test(tradingToken.toUpperCase()) || !ASSET.test(earningsToken.toUpperCase())) flags.push("INVALID_ASSET");
    if (referralCode.length > 64) flags.push("INVALID_REFERRAL_CODE");
    const raw: Record<string, string | number> = {
      sourceRow: rowNumber, Referral: uid, "Trading volume": volume, "Trading token": tradingToken,
      "Your Earnings": earnings, "Commission token": earningsToken
    };
    if (referralColumn) raw["Referral Code"] = referralCode;
    const normalized = flags.length ? null : {
      uid, tradingVolume: new Prisma.Decimal(volume).toFixed(10), tradingAsset: tradingToken.toUpperCase(),
      reportedEarnings: new Prisma.Decimal(earnings).toFixed(10), earningsAsset: earningsToken.toUpperCase(),
      referralCode: referralCode || null
    };
    if (uid) uids.set(uid, (uids.get(uid) ?? 0) + 1);
    drafts.push({ raw, flags, normalized });
  }
  if (!drafts.length || drafts.length > MAX_ROWS) throw new Error("Upload between 1 and 5000 rows per batch");
  for (const row of drafts) {
    const uid = String(row.raw.Referral ?? "");
    if (uid && (uids.get(uid) ?? 0) > 1) { row.flags.push("DUPLICATE_UID"); row.normalized = null; }
  }
  const drift = classifyHeaders([...headers.keys()], mexcReferralContract);
  return { rows: drafts, warnings: [...warnings, ...drift.fields.filter((field) => !warnings.some((warning) => warning.includes(field))).map((field) => `Extra column: ${field}`)], partial: batch.sourceAsOf < batch.periodEnd, schemaFingerprint: drift.fingerprint, contractVersion: drift.contractVersion, driftReport: { class: drift.class, fields: drift.fields } };
}

/** Contract validation for records already captured in the raw landing table. */
export function parseMexcRecords(records: Record<string, unknown>[], batch: BatchPeriod, sheetName: string): ActivityParse {
  sheetPeriod(sheetName, batch);
  if (!records.length || records.length > MAX_ROWS) throw new Error("Upload between 1 and 5000 rows per batch");
  const names = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const drift = classifyHeaders(names, mexcReferralContract);
  if (drift.class === "BREAKING") throw new Error(`BREAKING: ${drift.fields.join(", ")}`);
  const seen = new Map<string, number>();
  const rows: ActivityParsedRow[] = records.map((record, index) => {
    const canonical = canonicalizeRecord(record, mexcReferralContract);
    const raw = Object.fromEntries(Object.entries(canonical).filter(([name]) => MAPPED.has(name)).map(([name, value]) => [name, String(value ?? "")])) as Record<string, string>;
    raw.sourceRow = String(index + 2);
    const uid = raw.Referral?.trim() ?? "";
    const volume = raw["Trading volume"]?.trim() ?? "";
    const tradingToken = raw["Trading token"]?.trim() ?? "";
    const earnings = raw["Your Earnings"]?.trim() ?? "";
    const earningsToken = raw["Commission token"]?.trim() ?? "";
    const referralCode = raw["Referral Code"]?.trim() ?? "";
    const flags: string[] = [];
    if (!UID.test(uid)) flags.push("INVALID_UID");
    if (!AMOUNT.test(volume)) flags.push("INVALID_VOLUME");
    if (!AMOUNT.test(earnings)) flags.push("INVALID_EARNINGS");
    if (!ASSET.test(tradingToken.toUpperCase()) || !ASSET.test(earningsToken.toUpperCase())) flags.push("INVALID_ASSET");
    if (referralCode.length > 64) flags.push("INVALID_REFERRAL_CODE");
    if (uid) seen.set(uid, (seen.get(uid) ?? 0) + 1);
    return { raw, flags, normalized: flags.length ? null : {
      uid, tradingVolume: new Prisma.Decimal(volume).toFixed(10), tradingAsset: tradingToken.toUpperCase(),
      reportedEarnings: new Prisma.Decimal(earnings).toFixed(10), earningsAsset: earningsToken.toUpperCase(), referralCode: referralCode || null
    } };
  });
  for (const row of rows) if ((seen.get(String(row.raw.Referral ?? "")) ?? 0) > 1) { row.flags.push("DUPLICATE_UID"); row.normalized = null; }
  return { rows, warnings: drift.fields.map((field) => `Extra column: ${field}`), partial: Boolean(batch.sourceAsOf && batch.sourceAsOf < batch.periodEnd),
    schemaFingerprint: drift.fingerprint, contractVersion: drift.contractVersion, driftReport: { class: drift.class, fields: drift.fields } };
}

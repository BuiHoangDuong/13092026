import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { parse } from "csv-parse/sync";
import { db, Prisma, type IngestDatasetKind, type IngestSourceMethod, type RawLoad } from "@cashback/db";
import type { Cell, Workbook } from "exceljs";
import type { FieldContract } from "./contract.js";
import { assertSafeXlsx } from "../services/xlsx-safe.js";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs") as { Workbook: new () => Workbook; ValueType: { Formula: number } };
export type RawRecord = Record<string, unknown>;
export type RawFile = { records: RawRecord[]; fieldNames: string[]; sourceMetadata?: Record<string, string> };
class RawLoadError extends Error { readonly code = "IMPORT_INVALID"; }

function headerKeys(names: string[]) {
  const counts = new Map<string, number>();
  return names.map((name, index) => {
    const base = name === "" ? `__col_${index + 1}` : name;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });
}

function stripPersonal(record: RawRecord, contract: FieldContract): RawRecord {
  const personal = new Set((contract.personal ?? []).map((name) => name.toLowerCase()));
  return Object.fromEntries(Object.entries(record).filter(([name]) => !personal.has(name.toLowerCase())));
}

function cellValue(cell: Cell): string | number | boolean {
  const value = cell.value;
  if (cell.type === ExcelJS.ValueType.Formula || (value && typeof value === "object" && ("formula" in value || "sharedFormula" in value))) throw new Error("Spreadsheet formulas are not allowed");
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && "richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text;
  return JSON.stringify(value);
}

export async function readRawXlsx(bytes: Uint8Array, contract: FieldContract): Promise<RawFile> {
  await assertSafeXlsx(bytes);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const sheet = workbook.worksheets[0];
  if (!sheet || workbook.worksheets.length !== 1) throw new Error("Workbook must contain exactly one worksheet");
  if (sheet.columnCount > 64 || sheet.rowCount > 5001) throw new Error("Workbook exceeds the row or column limit");
  const keys = headerKeys(Array.from({ length: sheet.columnCount }, (_, index) => String(cellValue(sheet.getRow(1).getCell(index + 1)))));
  const records: RawRecord[] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const values = keys.map((_, index) => cellValue(sheet.getRow(rowNumber).getCell(index + 1)));
    if (values.every((value) => value === "")) continue;
    records.push(stripPersonal(Object.fromEntries(keys.map((key, index) => [key, values[index]])), contract));
  }
  if (!records.length || records.length > 5000) throw new Error("Upload between 1 and 5000 rows per batch");
  return { records, fieldNames: Object.keys(records[0]!), sourceMetadata: { sheetName: sheet.name } };
}

export function readRawCsv(bytes: Uint8Array, contract: FieldContract): RawFile {
  let keys: string[] = [];
  const records = parse(Buffer.from(bytes), { bom: true, skip_empty_lines: true, trim: false, max_record_size: 16_384,
    columns: (names: string[]) => { keys = headerKeys(names); return keys; }
  }) as Record<string, string>[];
  if (!records.length || records.length > 5000) throw new Error("Upload between 1 and 5000 rows per batch");
  return { records: records.map((record) => stripPersonal(record, contract)), fieldNames: keys.filter((key) => !(contract.personal ?? []).some((name) => name.toLowerCase() === key.toLowerCase())) };
}

export function readRawApi(records: RawRecord[], contract: FieldContract): RawFile {
  const safe = records.map((record) => stripPersonal(record, contract));
  const fieldNames = [...new Set(safe.flatMap((record) => Object.keys(record)))].sort();
  return { records: safe, fieldNames };
}

export type LoadInput = {
  exchangeId: string; sourceSystem: string; datasetKind: IngestDatasetKind; sourceMethod: IngestSourceMethod;
  rootAccount: string; periodStart: Date; periodEnd: Date; batchId?: string; runId?: string;
  sourceMetadata?: Record<string, string>; records: RawRecord[]; fieldNames: string[];
};

export function sliceKey(input: Pick<LoadInput, "exchangeId" | "datasetKind" | "sourceMethod" | "rootAccount" | "periodStart" | "periodEnd">) {
  return [input.exchangeId, input.datasetKind, input.sourceMethod, input.rootAccount, input.periodStart.toISOString(), input.periodEnd.toISOString()].join("|");
}

/** The insert, replacement and TRANSFORM enqueue are one atomic slice transaction. */
export async function writeRawLoad(input: LoadInput, lease?: { id: string; lockedBy: string }): Promise<RawLoad> {
  const id = randomUUID();
  const fingerprint = createHash("sha256").update([...input.fieldNames].sort().join("\n")).digest("hex");
  return db.$transaction(async (tx) => {
    if (lease) {
      const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Job" WHERE id = ${lease.id} AND "lockedBy" = ${lease.lockedBy} AND state = 'CLAIMED' AND "leaseUntil" > clock_timestamp() FOR SHARE`;
      if (!owned.length) throw new Error("LEASE_LOST");
    }
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(input)}))`;
    const old = await tx.rawLoad.findMany({ where: { exchangeId: input.exchangeId, datasetKind: input.datasetKind, sourceMethod: input.sourceMethod,
      rootAccount: input.rootAccount, periodStart: input.periodStart, periodEnd: input.periodEnd, state: { not: "SUPERSEDED" } }, select: { id: true } });
    if (old.length) {
      await tx.$executeRaw`DELETE FROM raw_record WHERE _load_id = ANY(${old.map((load) => load.id)}::text[])`;
      await tx.rawLoad.updateMany({ where: { id: { in: old.map((load) => load.id) } }, data: { state: "SUPERSEDED" } });
    }
    const load = await tx.rawLoad.create({ data: { id, exchangeId: input.exchangeId, sourceSystem: input.sourceSystem,
      datasetKind: input.datasetKind, sourceMethod: input.sourceMethod, rootAccount: input.rootAccount,
      periodStart: input.periodStart, periodEnd: input.periodEnd, batchId: input.batchId, runId: input.runId,
      rowCount: input.records.length, fieldNames: input.fieldNames, schemaFingerprint: fingerprint,
      sourceMetadata: input.sourceMetadata ?? Prisma.DbNull } });
    await tx.$executeRaw`INSERT INTO raw_record (_source_system, _load_id, row_no, payload)
      SELECT ${input.sourceSystem}, ${id}, record.ordinality::integer, record.value
      FROM jsonb_array_elements(${JSON.stringify(input.records)}::jsonb) WITH ORDINALITY AS record(value, ordinality)`;
    await tx.job.create({ data: { type: "TRANSFORM", payload: { loadId: id } } });
    return load;
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function readRawRows(loadId: string): Promise<RawRecord[]> {
  const rows = await db.$queryRaw<Array<{ payload: RawRecord }>>`SELECT payload FROM raw_record WHERE _load_id = ${loadId} ORDER BY row_no`;
  return rows.map((row) => row.payload);
}

export async function purgeTransformedRaw(now = new Date()) {
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const loads = await db.rawLoad.findMany({ where: { state: "TRANSFORMED", transformedAt: { lt: cutoff } }, select: { id: true }, take: 1000 });
  if (loads.length) await db.$executeRaw`DELETE FROM raw_record WHERE _load_id = ANY(${loads.map((load) => load.id)}::text[])`;
  return loads.length;
}

export async function requestRetransform(adminId: string, loadId: string) {
  return db.$transaction(async (tx) => {
    const load = await tx.rawLoad.findUnique({ where: { id: loadId } });
    if (!load || load.state !== "FAILED") throw new RawLoadError("Only a failed current raw load can be transformed again");
    const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM raw_record WHERE _load_id = ${loadId}`;
    if (!rows[0] || Number(rows[0].count) !== load.rowCount) throw new RawLoadError("Raw rows are unavailable; load the source again");
    await tx.rawTransformAudit.create({ data: { loadId, adminId } });
    if (load.batchId) await tx.importBatch.update({ where: { id: load.batchId }, data: { status: "PARSING" } });
    if (load.runId) await tx.syncRun.update({ where: { id: load.runId }, data: { state: "RUNNING", finishedAt: null, safeErrorCode: null } });
    await tx.job.create({ data: { type: "TRANSFORM", payload: { loadId } } });
    return { accepted: true, loadId };
  });
}

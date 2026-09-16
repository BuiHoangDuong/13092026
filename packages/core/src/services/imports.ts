import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportMetadata, ImportPreview } from "@cashback/contracts";
import { db, JobType, Prisma, type ImportBatch } from "@cashback/db";
import { parserRegistry, type NormalizedCommission } from "./bybit-parser.js";
import { lockCashback, withJobLease, type JobLease } from "./jobs.js";

export class ImportError extends Error {
  constructor(public readonly code: "IMPORT_INVALID" | "IMPORT_NOT_FOUND", message: string) { super(message); }
}
export type ImportFile = { bytes: Uint8Array; extension: "csv" | "xlsx" };

export async function createImportBatch(metadata: ImportMetadata, file: ImportFile) {
  const periodStart = new Date(metadata.periodStart), periodEnd = new Date(metadata.periodEnd);
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
    throw new ImportError("IMPORT_INVALID", "Invalid report period");
  }
  const exchange = await db.exchange.findUnique({ where: { id: metadata.exchangeId } });
  if (exchange?.slug !== "bybit") throw new ImportError("IMPORT_INVALID", "The first report adapter supports Bybit only");
  if (file.extension !== "csv" || metadata.sourceTz !== "UTC") throw new ImportError("IMPORT_INVALID", "Use normalized Bybit CSV v1 in UTC; XLSX is not supported yet");
  if (!file.bytes.length || file.bytes.length > 10 * 1024 * 1024) throw new ImportError("IMPORT_INVALID", "CSV must be between 1 byte and 10 MiB");
  const batchId = randomUUID();
  // Private DB-backed original: web and worker run on separate Railway filesystems.
  await db.$transaction(async tx => {
    await tx.importBatch.create({ data: {
      id: batchId, exchangeId: metadata.exchangeId, rootAccount: metadata.rootAccount,
      reportType: metadata.reportType, periodStart, periodEnd, sourceTz: metadata.sourceTz,
      sourceAsOf: metadata.sourceAsOf ? new Date(metadata.sourceAsOf) : null,
      fileRef: `db:${batchId}/original.csv`, originalFile: Buffer.from(file.bytes)
    } });
    await tx.job.create({ data: { type: JobType.PARSE, payload: { batchId } } });
  });
  return { batchId, status: "UPLOADED" as const };
}

async function originalBytes(batch: ImportBatch) {
  if (batch.originalFile) return batch.originalFile;
  const root = path.resolve(process.env.IMPORT_STORAGE_LOCAL_DIR ?? "../../infra/data/imports");
  const target = path.resolve(root, batch.fileRef);
  if (!target.startsWith(root + path.sep) || !target.endsWith(".csv")) throw new Error("Legacy report unavailable; upload normalized CSV again");
  return readFile(target);
}

async function conflict(tx: Prisma.TransactionClient, batch: ImportBatch, row: NormalizedCommission) {
  const existing = await tx.commissionRecord.findUnique({ where: { exchangeId_dedupKey: { exchangeId: batch.exchangeId, dedupKey: row.dedupKey } }, include: { activeVersion: { include: { batch: true } } } });
  if (existing && (existing.uid !== row.uid || existing.asset !== row.asset || existing.periodStart.toISOString() !== row.periodStart || existing.periodEnd.toISOString() !== row.periodEnd)) return "IDENTITY_CONFLICT";
  const previousBatch = existing?.activeVersion?.batch;
  if (previousBatch && previousBatch.id !== batch.id) {
    const previousTime = previousBatch.sourceAsOf ?? previousBatch.createdAt;
    const nextTime = batch.sourceAsOf ?? batch.createdAt;
    if (previousTime > nextTime || (previousTime.getTime() === nextTime.getTime() && previousBatch.createdAt > batch.createdAt)) return "OLDER_REPORT";
  }
  const overlapping = await tx.commissionRecord.findFirst({ where: {
    exchangeId: batch.exchangeId, uid: row.uid, asset: row.asset, dedupKey: { not: row.dedupKey },
    periodStart: { lte: new Date(row.periodEnd) }, periodEnd: { gte: new Date(row.periodStart) },
    ...(row.reportType === "TRANSACTION" ? { OR: [{ reportType: "AGGREGATE" }, { reportType: null }] } : {})
  } });
  if (overlapping) return "OVERLAPPING_PERIOD";
  if (row.referralLinkId) {
    const link = await tx.referralLink.findFirst({ where: { id: row.referralLinkId, exchangeId: batch.exchangeId } });
    if (!link) return "INVALID_REPORT_REFERRAL_LINK";
  }
  return null;
}

export async function parseImportJob(lease: JobLease, batchId: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status !== "UPLOADED" && batch.status !== "PARSING") return withJobLease(lease, async () => {});
  let parsed;
  try {
    const exchange = await db.exchange.findUniqueOrThrow({ where: { id: batch.exchangeId } });
    if (exchange.slug !== "bybit") throw new Error("No report adapter for this exchange");
    parsed = parserRegistry.bybit(await originalBytes(batch), batch);
  } catch (error) {
    return withJobLease(lease, async tx => {
      await tx.importBatch.update({ where: { id: batchId }, data: { status: "FAILED", totals: { error: error instanceof Error ? error.message : "Invalid CSV" } } });
    });
  }
  return withJobLease(lease, async tx => {
    await lockCashback(tx);
    const totals: Record<string, string> = {};
    let unmappedRows = 0;
    for (const row of parsed) {
      if (!row.normalized) continue;
      const issue = await conflict(tx, batch, row.normalized);
      if (issue) row.flags.push(issue);
      const { uid, asset, amount } = row.normalized;
      const link = await tx.uidLink.findFirst({ where: { exchangeId: batch.exchangeId, uid, status: "VERIFIED" } });
      if (!link) unmappedRows++;
      totals[asset] = new Prisma.Decimal(totals[asset] ?? 0).plus(amount).toFixed(10);
    }
    // Mixing aggregate and transaction rows within one file can double-count even on an empty DB.
    for (const row of parsed) {
      const value = row.normalized;
      if (value && parsed.some(other => other !== row && other.normalized && other.normalized.uid === value.uid && other.normalized.asset === value.asset && other.normalized.reportType !== value.reportType)) row.flags.push("MIXED_REPORT_TYPES");
    }
    await tx.stagingRow.deleteMany({ where: { batchId } });
    await tx.stagingRow.createMany({ data: parsed.map(row => ({ batchId, raw: row.raw,
      normalized: row.normalized ?? Prisma.DbNull, flags: row.flags.length ? row.flags : Prisma.DbNull })) });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "PREVIEW", totals: {
      assets: totals, unmappedRows, reportTypes: [...new Set(parsed.flatMap(row => row.normalized ? [row.normalized.reportType] : []))]
    } } });
  });
}

export async function commitImportBatch(batchId: string) {
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found");
    if (batch.status === "PUBLISHED" || batch.status === "COMMITTING") return { batchId, status: batch.status };
    if (batch.status !== "PREVIEW") throw new ImportError("IMPORT_INVALID", "Only previewed reports can be published");
    const flagged = await tx.stagingRow.count({ where: { batchId, flags: { not: Prisma.DbNull } } });
    if (flagged) throw new ImportError("IMPORT_INVALID", "Fix all flagged rows and upload again before publishing");
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "COMMITTING" } });
    await tx.job.create({ data: { type: "PUBLISH", payload: { batchId } } });
    return { batchId, status: "COMMITTING" };
  });
}

export async function publishImportJob(lease: JobLease, batchId: string) {
  return withJobLease(lease, async tx => {
    await lockCashback(tx);
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status === "PUBLISHED") return;
    if (batch.status !== "COMMITTING") throw new Error("Batch is not committing");
    const rows = await tx.stagingRow.findMany({ where: { batchId }, orderBy: { id: "asc" } });
    if (!rows.length || rows.some(row => row.flags || !row.normalized)) throw new Error("Invalid staging rows");
    // Recheck under the publish lock: a competing report may have been published after preview.
    for (const staged of rows) {
      const row = staged.normalized as unknown as NormalizedCommission;
      const issue = await conflict(tx, batch, row);
      if (issue) throw new Error(issue);
      const record = await tx.commissionRecord.upsert({
        where: { exchangeId_dedupKey: { exchangeId: batch.exchangeId, dedupKey: row.dedupKey } }, update: {},
        create: { exchangeId: batch.exchangeId, dedupKey: row.dedupKey, uid: row.uid, asset: row.asset,
          reportType: row.reportType, rootAccount: batch.rootAccount, periodStart: new Date(row.periodStart), periodEnd: new Date(row.periodEnd) }
      });
      const version = await tx.commissionVersion.upsert({ where: { commissionId_batchId: { commissionId: record.id, batchId } },
        update: {}, create: { commissionId: record.id, batchId, amount: row.amount, referralLinkId: row.referralLinkId } });
      await tx.commissionVersion.updateMany({ where: { commissionId: record.id, id: { not: version.id } }, data: { superseded: true } });
      await tx.commissionRecord.update({ where: { id: record.id }, data: { activeVersionId: version.id, reconciledAmount: row.amount } });
    }
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    await tx.job.create({ data: { type: "ATTRIBUTE", payload: { exchangeId: batch.exchangeId } } });
  });
}

export async function getImportPreview(batchId: string): Promise<ImportPreview> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found");
  const [totalRows, flaggedRows, rows] = await Promise.all([
    db.stagingRow.count({ where: { batchId } }),
    db.stagingRow.count({ where: { batchId, flags: { not: Prisma.DbNull } } }),
    db.stagingRow.findMany({ where: { batchId, flags: { not: Prisma.DbNull } }, select: { id: true, raw: true, normalized: true, flags: true }, orderBy: { id: "asc" }, take: 100 })
  ]);
  return { batch: {
    id: batch.id, exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, reportType: batch.reportType,
    status: batch.status, periodStart: batch.periodStart.toISOString(), periodEnd: batch.periodEnd.toISOString(),
    sourceTz: batch.sourceTz, sourceAsOf: batch.sourceAsOf?.toISOString() ?? null, totals: batch.totals, createdAt: batch.createdAt.toISOString()
  }, preview: { totalRows, flaggedRows, rows } };
}

export async function listImportBatches() {
  return db.importBatch.findMany({ take: 30, orderBy: { createdAt: "desc" }, select: {
    id: true, status: true, rootAccount: true, periodStart: true, periodEnd: true, createdAt: true, totals: true
  } });
}

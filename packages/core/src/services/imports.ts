import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImportMetadata, ImportPreview } from "@cashback/contracts";
import { db, JobType, Prisma, type ImportBatch } from "@cashback/db";
import { type NormalizedCommission, type ParsedRow } from "./bybit-parser.js";
import { resolveRegisteredFileAdapter, type UploadFile } from "../ingest/source-adapter.js";
import { readRawRows, sliceKey, writeRawLoad } from "../ingest/raw-landing.js";
import { lockActivityPeriod, lockCashback, withJobLease, type JobLease } from "./jobs.js";
import { type ActivityNormalized, type ActivityParse } from "./mexc-parser.js";

export class ImportError extends Error {
  constructor(public readonly code: "IMPORT_INVALID" | "IMPORT_NOT_FOUND", message: string) { super(message); }
}
export type ImportFile = UploadFile;

function asImportError(error: unknown) {
  return new ImportError("IMPORT_INVALID", error instanceof Error ? error.message : "Invalid import");
}

export async function createImportBatch(metadata: ImportMetadata, file: ImportFile) {
  const periodStart = new Date(metadata.periodStart), periodEnd = new Date(metadata.periodEnd);
  if (!Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || periodStart > periodEnd) {
    throw new ImportError("IMPORT_INVALID", "Invalid report period");
  }
  const exchange = await db.exchange.findUnique({ where: { id: metadata.exchangeId } });
  if (!exchange) throw new ImportError("IMPORT_INVALID", "Exchange not found");
  const resolved = resolveRegisteredFileAdapter({
    exchangeSlug: exchange.slug, datasetKind: metadata.datasetKind, sourceMethod: metadata.sourceMethod, extension: file.extension
  });
  if (!resolved) throw new ImportError("IMPORT_INVALID", "No report adapter matches this exchange, dataset and file");
  if (resolved.mismatch) throw new ImportError("IMPORT_INVALID", "The file does not match the selected dataset");
  try { resolved.adapter.assertUpload(file, metadata); }
  catch (error) { throw asImportError(error); }
  const batchId = randomUUID();
  const sourceAsOf = metadata.sourceAsOf ? new Date(metadata.sourceAsOf) : null;
  await db.$transaction(async tx => {
    await tx.importBatch.create({ data: {
      id: batchId, exchangeId: metadata.exchangeId, rootAccount: metadata.rootAccount,
      datasetKind: metadata.datasetKind, sourceMethod: metadata.sourceMethod,
      reportType: metadata.datasetKind === "COMMISSION" ? metadata.reportType : null,
      periodStart, periodEnd, sourceTz: metadata.sourceTz, sourceAsOf,
      fileRef: `db:${batchId}/original.${file.extension}`, originalFile: Buffer.from(file.bytes),
      adapterId: resolved.adapter.id, contractVersion: resolved.adapter.contract.version
    } });
    await tx.job.create({ data: { type: JobType.LOAD, payload: { batchId } } });
  });
  return { batchId, status: "UPLOADED" as const };
}

function fileExtension(fileRef: string): string {
  return path.extname(fileRef).slice(1).toLowerCase();
}

async function originalBytes(batch: ImportBatch) {
  if (batch.originalFile) return batch.originalFile;
  const root = path.resolve(process.env.IMPORT_STORAGE_LOCAL_DIR ?? "../../infra/data/imports");
  const target = path.resolve(root, batch.fileRef);
  if (!target.startsWith(root + path.sep) || !/^[a-z0-9]+$/.test(fileExtension(target))) throw new Error("Legacy report unavailable; upload the report again");
  return readFile(target);
}

async function conflict(tx: Prisma.TransactionClient, batch: ImportBatch, row: NormalizedCommission) {
  const existing = await tx.commissionRecord.findUnique({ where: { exchangeId_dedupKey: { exchangeId: batch.exchangeId, dedupKey: row.dedupKey } }, include: { activeVersion: { include: { batch: true } } } });
  if (existing && (existing.uid !== row.uid || existing.asset !== row.asset || existing.periodStart.toISOString() !== row.periodStart || existing.periodEnd.toISOString() !== row.periodEnd)) return "IDENTITY_CONFLICT";
  const previousBatch = existing?.activeVersion?.batch;
  if (previousBatch && previousBatch.id !== batch.id && isOlderReport(batch, previousBatch)) return "OLDER_REPORT";
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

function isOlderReport(candidate: Pick<ImportBatch, "sourceAsOf" | "createdAt">, current: Pick<ImportBatch, "sourceAsOf" | "createdAt">) {
  const next = (candidate.sourceAsOf ?? candidate.createdAt).getTime();
  const previous = (current.sourceAsOf ?? current.createdAt).getTime();
  return next < previous || (next === previous && candidate.createdAt < current.createdAt);
}

function activityKey(batch: Pick<ImportBatch, "exchangeId" | "rootAccount" | "periodStart" | "periodEnd">) {
  return `${batch.exchangeId}|${batch.rootAccount}|${batch.periodStart.toISOString()}|${batch.periodEnd.toISOString()}`;
}

async function failBatch(lease: JobLease, batchId: string, error: unknown) {
  return withJobLease(lease, async tx => {
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "FAILED", totals: { error: error instanceof Error ? error.message : "Invalid report" } } });
  });
}

async function stageCommission(lease: JobLease, batch: ImportBatch, parsed: ParsedRow[], loadId?: string) {
  return withJobLease(lease, async tx => {
    if (loadId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(batch)}))`;
      const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
      if (current.state === "SUPERSEDED") return;
    }
    await lockCashback(tx);
    const totals: Record<string, string> = {};
    const unmappedRows = 0;
    for (const row of parsed) {
      if (!row.normalized) continue;
      const issue = await conflict(tx, batch, row.normalized);
      if (issue) row.flags.push(issue);
      const { asset, amount } = row.normalized;
      totals[asset] = new Prisma.Decimal(totals[asset] ?? 0).plus(amount).toFixed(10);
    }
    for (const row of parsed) {
      const value = row.normalized;
      if (value && parsed.some(other => other !== row && other.normalized && other.normalized.uid === value.uid && other.normalized.asset === value.asset && other.normalized.reportType !== value.reportType)) row.flags.push("MIXED_REPORT_TYPES");
    }
    await tx.stagingRow.deleteMany({ where: { batchId: batch.id } });
    await tx.stagingRow.createMany({ data: parsed.map(row => ({ batchId: batch.id, raw: row.raw,
      normalized: row.normalized ?? Prisma.DbNull, flags: row.flags.length ? row.flags : Prisma.DbNull })) });
    const meta = parsed as ParsedRow[] & { warnings?: string[]; schemaFingerprint?: string; contractVersion?: string; driftReport?: Prisma.InputJsonObject };
     await tx.importBatch.update({ where: { id: batch.id }, data: { status: "PREVIEW", schemaFingerprint: meta.schemaFingerprint, driftReport: meta.driftReport, totals: {
      assets: totals, unmappedRows, warnings: meta.warnings ?? [], reportTypes: [...new Set(parsed.flatMap(row => row.normalized ? [row.normalized.reportType] : []))]
    } } });
    if (loadId) await tx.rawLoad.update({ where: { id: loadId }, data: { state: "TRANSFORMED", transformedAt: new Date(), driftReport: meta.driftReport ?? Prisma.DbNull } });
  });
}

async function stageActivity(lease: JobLease, batch: ImportBatch, parsed: ActivityParse, loadId?: string) {
  return withJobLease(lease, async tx => {
    if (loadId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(batch)}))`;
      const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
      if (current.state === "SUPERSEDED") return;
    }
    const current = await tx.referralSnapshot.findFirst({
      where: { exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd, current: true },
      include: { batch: true }
    });
    const older = Boolean(current && current.batchId !== batch.id && isOlderReport(batch, current.batch));
    const rows = parsed.rows.map((row) => older ? { ...row, flags: [...row.flags, "OLDER_REPORT"], normalized: null } : row);
    const tradingVolume: Record<string, string> = {};
    const reportedEarnings: Record<string, string> = {};
    for (const row of rows) {
      if (!row.normalized) continue;
      tradingVolume[row.normalized.tradingAsset] = new Prisma.Decimal(tradingVolume[row.normalized.tradingAsset] ?? 0).plus(row.normalized.tradingVolume).toFixed(10);
      reportedEarnings[row.normalized.earningsAsset] = new Prisma.Decimal(reportedEarnings[row.normalized.earningsAsset] ?? 0).plus(row.normalized.reportedEarnings).toFixed(10);
    }
    await tx.stagingRow.deleteMany({ where: { batchId: batch.id } });
    await tx.stagingRow.createMany({ data: rows.map((row) => ({
      batchId: batch.id, raw: row.raw as Prisma.InputJsonObject,
      normalized: row.normalized ?? Prisma.DbNull, flags: row.flags.length ? row.flags : Prisma.DbNull
    })) });
     await tx.importBatch.update({ where: { id: batch.id }, data: { status: "PREVIEW", schemaFingerprint: parsed.schemaFingerprint, driftReport: parsed.driftReport, totals: {
      partial: parsed.partial, warnings: parsed.warnings, affectsCashback: false, tradingVolume, reportedEarnings
    } } });
    if (loadId) await tx.rawLoad.update({ where: { id: loadId }, data: { state: "TRANSFORMED", transformedAt: new Date(), driftReport: parsed.driftReport ?? Prisma.DbNull } });
  });
}

export async function parseImportJob(lease: JobLease, batchId: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.status !== "UPLOADED" && batch.status !== "PARSING") return withJobLease(lease, async () => {});
  try {
    const exchange = await db.exchange.findUniqueOrThrow({ where: { id: batch.exchangeId } });
    const extension = fileExtension(batch.fileRef);
    const resolved = resolveRegisteredFileAdapter({ exchangeSlug: exchange.slug, datasetKind: batch.datasetKind, sourceMethod: batch.sourceMethod, extension, contractVersion: batch.contractVersion, adapterId: batch.adapterId });
    if (!resolved || resolved.mismatch) throw new Error("No report adapter for this exchange");
    const bytes = await originalBytes(batch);
    const raw = await resolved.adapter.load(bytes);
    await writeRawLoad({ exchangeId: batch.exchangeId, sourceSystem: exchange.slug, datasetKind: batch.datasetKind,
      sourceMethod: batch.sourceMethod, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd,
      batchId, records: raw.records, fieldNames: raw.fieldNames, sourceMetadata: raw.sourceMetadata }, lease);
  } catch (error) {
    return failBatch(lease, batchId, error);
  }
  return withJobLease(lease, async tx => { await tx.importBatch.update({ where: { id: batchId }, data: { status: "PARSING" } }); });
}

export async function transformImportJob(lease: JobLease, loadId: string) {
  const load = await db.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
  if (load.state === "SUPERSEDED" || load.state === "TRANSFORMED") return withJobLease(lease, async () => {});
  if (!load.batchId) throw new Error("Manual transform has no batch");
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: load.batchId } });
  try {
    const resolved = resolveRegisteredFileAdapter({ exchangeSlug: load.sourceSystem, datasetKind: batch.datasetKind,
      sourceMethod: batch.sourceMethod, extension: fileExtension(batch.fileRef), adapterId: batch.adapterId, contractVersion: batch.contractVersion });
    if (!resolved || resolved.mismatch) throw new Error("NO_ADAPTER");
    const rows = await readRawRows(loadId);
    const parsed = await resolved.adapter.transform(rows, batch, (load.sourceMetadata ?? {}) as Record<string, string>);
    if (parsed.kind === "REFERRAL_ACTIVITY") return stageActivity(lease, batch, parsed.activity, loadId);
    return stageCommission(lease, batch, parsed.rows, loadId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TRANSFORM_FAILED";
    return withJobLease(lease, async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(16092028, hashtext(${sliceKey(batch)}))`;
      const current = await tx.rawLoad.findUniqueOrThrow({ where: { id: loadId } });
      if (current.state === "SUPERSEDED") return;
      await tx.rawLoad.update({ where: { id: loadId }, data: { state: "FAILED", safeErrorCode: message.startsWith("BREAKING") ? "BREAKING" : "TRANSFORM_FAILED",
        driftReport: { class: message.startsWith("BREAKING") ? "BREAKING" : "ERROR", fields: message.startsWith("BREAKING") ? message.slice(10).split(", ") : [] } } });
      await tx.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED", totals: { error: message.startsWith("BREAKING") ? "Schema changed" : "Transform failed" } } });
    });
  }
}

export async function commitImportBatch(batchId: string) {
  return db.$transaction(async tx => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found");
    if (batch.datasetKind === "COMMISSION") await lockCashback(tx);
    if (batch.status === "PUBLISHED" || batch.status === "COMMITTING") return { batchId, status: batch.status };
    if (batch.status !== "PREVIEW") throw new ImportError("IMPORT_INVALID", "Only previewed reports can be published");
    const flagged = await tx.stagingRow.count({ where: { batchId, flags: { not: Prisma.DbNull } } });
    if (flagged) throw new ImportError("IMPORT_INVALID", "Fix all flagged rows and upload again before publishing");
    const updated = await tx.importBatch.updateMany({ where: { id: batchId, status: "PREVIEW" }, data: { status: "COMMITTING" } });
    if (!updated.count) {
      const again = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
      return { batchId, status: again.status };
    }
    await tx.job.create({ data: { type: "PUBLISH", payload: { batchId } } });
    return { batchId, status: "COMMITTING" as const };
  });
}

function activityRow(value: Prisma.JsonValue): ActivityNormalized {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid staging rows");
  const row = value as Record<string, Prisma.JsonValue>;
  if (typeof row.uid !== "string" || typeof row.tradingVolume !== "string" || typeof row.tradingAsset !== "string" ||
      typeof row.reportedEarnings !== "string" || typeof row.earningsAsset !== "string" ||
      !(typeof row.referralCode === "string" || row.referralCode === null)) throw new Error("Invalid staging rows");
  return {
    uid: row.uid, tradingVolume: row.tradingVolume, tradingAsset: row.tradingAsset,
    reportedEarnings: row.reportedEarnings, earningsAsset: row.earningsAsset, referralCode: row.referralCode
  };
}

async function publishCommissionJob(lease: JobLease, batchId: string) {
  return withJobLease(lease, async tx => {
    await lockCashback(tx);
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status === "PUBLISHED") return;
    if (batch.status !== "COMMITTING") throw new Error("Batch is not committing");
    const rows = await tx.stagingRow.findMany({ where: { batchId }, orderBy: { id: "asc" } });
    if (!rows.length || rows.some(row => row.flags || !row.normalized)) throw new Error("Invalid staging rows");
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

async function publishActivityJob(lease: JobLease, batchId: string) {
  return withJobLease(lease, async tx => {
    const batch = await tx.importBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status === "PUBLISHED") return;
    if (batch.status !== "COMMITTING") throw new Error("Batch is not committing");
    await lockActivityPeriod(tx, activityKey(batch));
    const rows = await tx.stagingRow.findMany({ where: { batchId }, orderBy: { id: "asc" } });
    if (!rows.length || rows.some((row) => row.flags || !row.normalized)) throw new Error("Invalid staging rows");
    const current = await tx.referralSnapshot.findFirst({
      where: { exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd, current: true },
      include: { batch: true }
    });
    if (current && current.batchId !== batch.id && isOlderReport(batch, current.batch)) throw new Error("OLDER_REPORT");
    await tx.referralSnapshot.updateMany({
      where: { exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd, current: true },
      data: { current: false }
    });
    const partial = batch.sourceAsOf != null && batch.sourceAsOf < batch.periodEnd;
    for (const staged of rows) {
      const row = activityRow(staged.normalized);
      const snapshot = await tx.referralSnapshot.upsert({
        where: { batchId_uid: { batchId, uid: row.uid } }, update: {},
        create: {
          batchId, exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, uid: row.uid,
          periodStart: batch.periodStart, periodEnd: batch.periodEnd, tradingVolume: row.tradingVolume,
          tradingAsset: row.tradingAsset, reportedEarnings: row.reportedEarnings, earningsAsset: row.earningsAsset,
          referralCode: row.referralCode, partial, current: true
        }
      });
      await tx.referralMetric.createMany({ data: [
        { snapshotId: snapshot.id, kind: "TRADE_VOLUME", asset: row.tradingAsset, valueState: "VALUE", amount: row.tradingVolume },
        { snapshotId: snapshot.id, kind: "REPORTED_COMMISSION", asset: row.earningsAsset, valueState: "VALUE", amount: row.reportedEarnings }
      ], skipDuplicates: true });
    }
    await tx.activityPeriodOverride.upsert({
      where: { exchangeId_rootAccount_periodStart_periodEnd: { exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd } },
      update: { manualBatchId: batch.id, active: true, updatedBy: "publish" },
      create: { exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, periodStart: batch.periodStart, periodEnd: batch.periodEnd, manualBatchId: batch.id, active: true, updatedBy: "publish" }
    });
    await tx.importBatch.update({ where: { id: batchId }, data: { status: "PUBLISHED", publishedAt: new Date() } });
  });
}

export async function publishImportJob(lease: JobLease, batchId: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.datasetKind === "REFERRAL_ACTIVITY") return publishActivityJob(lease, batchId);
  return publishCommissionJob(lease, batchId);
}

export async function getImportPreview(batchId: string): Promise<ImportPreview> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found");
  const [totalRows, flaggedRows, rows, rawLoad] = await Promise.all([
    db.stagingRow.count({ where: { batchId } }),
    db.stagingRow.count({ where: { batchId, flags: { not: Prisma.DbNull } } }),
    db.stagingRow.findMany({ where: { batchId, flags: { not: Prisma.DbNull } }, select: { id: true, raw: true, normalized: true, flags: true }, orderBy: { id: "asc" }, take: 100 }),
    db.rawLoad.findFirst({ where: { batchId, state: { not: "SUPERSEDED" } }, orderBy: { loadedAt: "desc" }, select: { id: true, state: true, rowCount: true, fieldNames: true, driftReport: true, safeErrorCode: true } })
  ]);
  return { batch: {
    id: batch.id, exchangeId: batch.exchangeId, rootAccount: batch.rootAccount,
    datasetKind: batch.datasetKind, sourceMethod: batch.sourceMethod, reportType: batch.reportType,
    affectsCashback: batch.datasetKind === "COMMISSION",
    status: batch.status, periodStart: batch.periodStart.toISOString(), periodEnd: batch.periodEnd.toISOString(),
    sourceTz: batch.sourceTz, sourceAsOf: batch.sourceAsOf?.toISOString() ?? null, totals: batch.totals, createdAt: batch.createdAt.toISOString()
  }, preview: { totalRows, flaggedRows, rows }, rawLoad: rawLoad ? { ...rawLoad, fieldNames: rawLoad.fieldNames as string[] } : null };
}

export async function listImportBatches(options: {
  exchangeId?: string;
  datasetKind?: ImportBatch["datasetKind"];
  sourceMethod?: ImportBatch["sourceMethod"];
  status?: ImportBatch["status"];
  cursor?: string;
  limit?: number;
} = {}) {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const rows = await db.importBatch.findMany({
    where: {
      ...(options.exchangeId ? { exchangeId: options.exchangeId } : {}),
      ...(options.datasetKind ? { datasetKind: options.datasetKind } : {}),
      ...(options.sourceMethod ? { sourceMethod: options.sourceMethod } : {}),
      ...(options.status ? { status: options.status } : {})
    },
    orderBy: { id: "desc" },
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true, status: true, rootAccount: true, exchangeId: true, datasetKind: true, sourceMethod: true,
      periodStart: true, periodEnd: true, createdAt: true, totals: true
    }
  });
  const page = rows.slice(0, limit);
  return { batches: page, nextCursor: rows.length > limit ? page.at(-1)?.id ?? null : null };
}

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ImportMetadata, ImportPreview } from "@cashback/contracts";
import { BatchStatus, db, JobState, JobType, Prisma, ReportType } from "@cashback/db";

export class ImportError extends Error {
  constructor(public readonly code: "IMPORT_INVALID" | "IMPORT_NOT_FOUND", message: string) {
    super(message);
  }
}

export type ImportFile = { bytes: Uint8Array; extension: "csv" | "xlsx" };

function storageRoot() {
  return path.resolve(process.env.IMPORT_STORAGE_LOCAL_DIR ?? "../../infra/data/imports");
}

async function storeOriginal(batchId: string, file: ImportFile) {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  const fileRef = `${batchId}/original.${file.extension}`;
  const absolutePath = path.join(root, fileRef);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, file.bytes, { flag: "wx", mode: 0o600 });
  return { fileRef, absolutePath };
}

export async function createImportBatch(metadata: ImportMetadata, file: ImportFile) {
  const periodStart = new Date(metadata.periodStart);
  const periodEnd = new Date(metadata.periodEnd);
  if (periodStart > periodEnd) throw new ImportError("IMPORT_INVALID", "periodStart must be before or equal to periodEnd");
  const exchange = await db.exchange.findUnique({ where: { id: metadata.exchangeId }, select: { id: true } });
  if (!exchange) throw new ImportError("IMPORT_INVALID", "Exchange not found");

  const batchId = randomUUID();
  const stored = await storeOriginal(batchId, file);
  try {
    await db.$transaction(async (tx) => {
      await tx.importBatch.create({ data: {
        id: batchId, exchangeId: metadata.exchangeId, rootAccount: metadata.rootAccount,
        reportType: metadata.reportType === "TRANSACTION" ? ReportType.TRANSACTION : ReportType.AGGREGATE,
        periodStart, periodEnd, sourceTz: metadata.sourceTz, fileRef: stored.fileRef, status: BatchStatus.UPLOADED
      } });
      await tx.job.create({ data: { type: JobType.PARSE, state: JobState.PENDING, payload: { batchId } } });
    });
  } catch (error) {
    await rm(path.dirname(stored.absolutePath), { recursive: true, force: true });
    throw error;
  }
  return { batchId, status: "UPLOADED" as const };
}

export async function getImportPreview(batchId: string): Promise<ImportPreview> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw new ImportError("IMPORT_NOT_FOUND", "Import batch not found");
  const [totalRows, flaggedRows, rows] = await Promise.all([
    db.stagingRow.count({ where: { batchId } }),
    db.stagingRow.count({ where: { batchId, flags: { not: Prisma.DbNull } } }),
    db.stagingRow.findMany({ where: { batchId, flags: { not: Prisma.DbNull } }, select: { id: true, raw: true, normalized: true, flags: true }, orderBy: { id: "asc" }, take: 100 })
  ]);
  return {
    batch: {
      id: batch.id, exchangeId: batch.exchangeId, rootAccount: batch.rootAccount, reportType: batch.reportType,
      status: batch.status, periodStart: batch.periodStart.toISOString(), periodEnd: batch.periodEnd.toISOString(),
      sourceTz: batch.sourceTz, sourceAsOf: batch.sourceAsOf?.toISOString() ?? null, totals: batch.totals,
      createdAt: batch.createdAt.toISOString()
    },
    preview: { totalRows, flaggedRows, rows }
  };
}

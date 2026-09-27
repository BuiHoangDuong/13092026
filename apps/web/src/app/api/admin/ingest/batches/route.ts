import { importMetadataSchema } from "@cashback/contracts";
import { createImportBatch, listFileAdapterDescriptors, listImportBatches } from "@cashback/core";
import { adminJson, withAdmin, withAdminMutation } from "@/lib/admin-api";

const datasetKinds = new Set(["COMMISSION", "REFERRAL_ACTIVITY"]);
const sourceMethods = new Set(["NATIVE_FILE", "NORMALIZED_FILE", "OFFICIAL_API"]);
const statuses = new Set(["UPLOADED", "PARSING", "PREVIEW", "COMMITTING", "PUBLISHED", "FAILED"]);

export const GET = (request: Request) => withAdmin(async () => {
  const params = new URL(request.url).searchParams;
  const datasetKind = datasetKinds.has(params.get("datasetKind") ?? "") ? params.get("datasetKind") as "COMMISSION" | "REFERRAL_ACTIVITY" : undefined;
  const sourceMethod = sourceMethods.has(params.get("sourceMethod") ?? "") ? params.get("sourceMethod") as "NATIVE_FILE" | "NORMALIZED_FILE" | "OFFICIAL_API" : undefined;
  const status = statuses.has(params.get("status") ?? "") ? params.get("status") as "UPLOADED" | "PARSING" | "PREVIEW" | "COMMITTING" | "PUBLISHED" | "FAILED" : undefined;
  const limit = Number(params.get("limit") ?? 30);
  const page = await listImportBatches({
    exchangeId: params.get("exchangeId") ?? undefined,
    datasetKind, sourceMethod, status,
    cursor: params.get("cursor") ?? undefined,
    limit: Number.isFinite(limit) ? limit : 30
  });
  return adminJson({
    batches: page.batches.map((batch) => ({ ...batch, affectsCashback: batch.datasetKind === "COMMISSION", periodStart: batch.periodStart.toISOString(), periodEnd: batch.periodEnd.toISOString(), createdAt: batch.createdAt.toISOString() })),
    nextCursor: page.nextCursor
  });
});

export const POST = (request: Request) => withAdminMutation(request, async () => {
  const form = await request.formData();
  const upload = form.get("file");
  const rawMetadata = form.get("metadata");
  if (!(upload instanceof File) || typeof rawMetadata !== "string") {
    return adminJson({ error: { code: "VALIDATION_ERROR", message: "file and metadata are required" } }, { status: 400 });
  }
  const extension = /\.([a-z0-9]+)$/i.exec(upload.name)?.[1]?.toLowerCase();
  const accepted = new Set(listFileAdapterDescriptors().flatMap((adapter) => adapter.accept.map((entry) => entry.toLowerCase().replace(/^\./, ""))));
  const configuredMax = Number(process.env.IMPORT_MAX_BYTES ?? 10 * 1024 * 1024);
  const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10 * 1024 * 1024;
  if (!extension || !accepted.has(extension) || upload.size === 0 || upload.size > maxBytes) {
    return adminJson({ error: { code: "INVALID_FILE", message: `Use a supported, non-empty file no larger than ${maxBytes} bytes` } }, { status: 400 });
  }
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(rawMetadata); } catch { return adminJson({ error: { code: "VALIDATION_ERROR", message: "metadata must be valid JSON" } }, { status: 400 }); }
  const metadata = importMetadataSchema.safeParse(parsedJson);
  if (!metadata.success) return adminJson({ error: { code: "VALIDATION_ERROR", message: "Invalid import metadata", details: metadata.error.issues } }, { status: 400 });
  const bytes = new Uint8Array(await upload.arrayBuffer());
  return adminJson(await createImportBatch(metadata.data, { bytes, extension }), { status: 202 });
});

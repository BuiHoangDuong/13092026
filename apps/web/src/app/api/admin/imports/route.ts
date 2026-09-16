import { importMetadataSchema } from "@cashback/contracts";
import { createImportBatch, listImportBatches } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

const allowedTypes = new Map([
  ["text/csv", "csv"], ["application/csv", "csv"], ["application/vnd.ms-excel", "csv"],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"]
] as const);
type AllowedMime = "text/csv" | "application/csv" | "application/vnd.ms-excel" | "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const GET = () => withAdmin(async () => adminJson({ batches: await listImportBatches() }));

export const POST = (request: Request) => withAdmin(async () => {
  const form = await request.formData();
  const upload = form.get("file");
  const rawMetadata = form.get("metadata");
  if (!(upload instanceof File) || typeof rawMetadata !== "string") {
    return adminJson({ error: { code: "VALIDATION_ERROR", message: "file and metadata are required" } }, { status: 400 });
  }
  const extension = allowedTypes.get(upload.type as AllowedMime) ?? (upload.name.toLowerCase().endsWith(".csv") ? "csv" : upload.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : undefined);
  const configuredMax = Number(process.env.IMPORT_MAX_BYTES ?? 10 * 1024 * 1024);
  const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : 10 * 1024 * 1024;
  if (!extension || upload.size === 0 || upload.size > maxBytes) {
    return adminJson({ error: { code: "INVALID_FILE", message: `Use a non-empty CSV/XLSX file no larger than ${maxBytes} bytes` } }, { status: 400 });
  }
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(rawMetadata); } catch { return adminJson({ error: { code: "VALIDATION_ERROR", message: "metadata must be valid JSON" } }, { status: 400 }); }
  const metadata = importMetadataSchema.safeParse(parsedJson);
  if (!metadata.success) return adminJson({ error: { code: "VALIDATION_ERROR", message: "Invalid import metadata", details: metadata.error.issues } }, { status: 400 });
  const bytes = new Uint8Array(await upload.arrayBuffer());
  const validSignature = extension === "xlsx"
    ? bytes[0] === 0x50 && bytes[1] === 0x4b
    : !bytes.includes(0);
  if (!validSignature) return adminJson({ error: { code: "INVALID_FILE", message: "File content does not match CSV/XLSX format" } }, { status: 400 });
  const result = await createImportBatch(metadata.data, { bytes, extension });
  return adminJson(result, { status: 202 });
});

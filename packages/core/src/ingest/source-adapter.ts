import { assertContract, bybitAffiliateContract, bybitCsvContract, mexcAffiliateContract, mexcReferralContract, type FieldContract } from "./contract.js";
import { fetchAffiliateDay, mapAffiliateRecords } from "./bybit-affiliate.js";
import { fetchMexcDay, mapMexcRecords } from "./mexc-affiliate.js";
import type { ImportMetadata } from "@cashback/contracts";
import type { ImportBatch } from "@cashback/db";
import { assertBybitCsvUpload, parseBybitCsv, parseBybitRecords, type ParsedRow } from "../services/bybit-parser.js";
import { assertMexcUpload, parseMexcReferralXlsx, parseMexcRecords, type ActivityParse } from "../services/mexc-parser.js";
import { readRawCsv, readRawXlsx, type RawFile, type RawRecord } from "./raw-landing.js";

export type IngestKey = { exchangeSlug: string; datasetKind: string; sourceMethod: string; format: string; contractVersion: string };

export type AdapterDescriptor = {
  id: string;
  exchangeSlug: string;
  datasetKind: "REFERRAL_ACTIVITY" | "COMMISSION";
  sourceMethod: "NATIVE_FILE" | "NORMALIZED_FILE" | "OFFICIAL_API";
  accept: string[];
  fields: string[];
  affectsCashback: boolean;
  contractVersion: string;
};

export abstract class SourceAdapter {
  abstract readonly id: string;
  abstract readonly exchangeSlug: string;
  abstract readonly datasetKind: "REFERRAL_ACTIVITY" | "COMMISSION";
  abstract readonly sourceMethod: "NATIVE_FILE" | "NORMALIZED_FILE" | "OFFICIAL_API";
  abstract readonly format: string;
  abstract readonly accept: string[];
  abstract readonly uploadFields: string[];
  abstract readonly affectsCashback: boolean;
  abstract readonly contract: FieldContract;
  key(): IngestKey {
    return { exchangeSlug: this.exchangeSlug, datasetKind: this.datasetKind, sourceMethod: this.sourceMethod, format: this.format, contractVersion: this.contract.version };
  }
  describe(): AdapterDescriptor {
    return {
      id: this.id, exchangeSlug: this.exchangeSlug, datasetKind: this.datasetKind, sourceMethod: this.sourceMethod,
      accept: this.accept, fields: this.uploadFields, affectsCashback: this.affectsCashback, contractVersion: this.contract.version
    };
  }
}

export type FileParseResult = { kind: "COMMISSION"; rows: ParsedRow[] } | { kind: "REFERRAL_ACTIVITY"; activity: ActivityParse };
export type UploadFile = { bytes: Uint8Array; extension: string };

export abstract class FileSourceAdapter extends SourceAdapter {
  abstract assertUpload(file: UploadFile, metadata: ImportMetadata): void;
  abstract load(bytes: Uint8Array): Promise<RawFile>;
  abstract transform(records: RawRecord[], batch: ImportBatch, metadata: Record<string, string>): Promise<FileParseResult>;
  abstract parse(bytes: Uint8Array, batch: ImportBatch): Promise<FileParseResult>;
}
export abstract class CsvSourceAdapter extends FileSourceAdapter { readonly format = "csv" as const; }
export abstract class XlsxSourceAdapter extends FileSourceAdapter { readonly format = "xlsx" as const; }
export abstract class ApiSourceAdapter extends SourceAdapter { readonly format = "api" as const; readonly sourceMethod = "OFFICIAL_API" as const; }

export class BybitNormalizedCsvAdapter extends CsvSourceAdapter {
  readonly id = "bybit-normalized-csv";
  readonly exchangeSlug = "bybit";
  readonly datasetKind = "COMMISSION" as const;
  readonly sourceMethod = "NORMALIZED_FILE" as const;
  readonly accept = [".csv"];
  readonly uploadFields = ["rootAccount", "period", "reportType"];
  readonly affectsCashback = true;
  readonly contract = bybitCsvContract;
  assertUpload(file: UploadFile, metadata: ImportMetadata) {
    if (metadata.datasetKind !== "COMMISSION") throw new Error("Commission imports require a report type");
    assertBybitCsvUpload(file, metadata);
  }
  async parse(bytes: Uint8Array, batch: ImportBatch): Promise<FileParseResult> {
    if (batch.reportType !== "TRANSACTION" && batch.reportType !== "AGGREGATE") throw new Error("Commission imports require a report type");
    return { kind: "COMMISSION", rows: parseBybitCsv(bytes, { ...batch, reportType: batch.reportType }) };
  }
  async load(bytes: Uint8Array) { return readRawCsv(bytes, this.contract); }
  async transform(records: RawRecord[], batch: ImportBatch): Promise<FileParseResult> {
    return { kind: "COMMISSION", rows: parseBybitRecords(records, batch) };
  }
}

export class MexcReferralXlsxAdapter extends XlsxSourceAdapter {
  readonly id = "mexc-referral-xlsx";
  readonly exchangeSlug = "mexc";
  readonly datasetKind = "REFERRAL_ACTIVITY" as const;
  readonly sourceMethod = "NATIVE_FILE" as const;
  readonly accept = [".xlsx"];
  readonly uploadFields = ["rootAccount", "sourceTz", "period", "sourceAsOf"];
  readonly affectsCashback = false;
  readonly contract = mexcReferralContract;
  assertUpload(file: UploadFile, metadata: ImportMetadata) {
    if (metadata.datasetKind !== "REFERRAL_ACTIVITY") throw new Error("Referral activity requires a source as-of time");
    assertMexcUpload(file, metadata);
  }
  async parse(bytes: Uint8Array, batch: ImportBatch): Promise<FileParseResult> {
    return { kind: "REFERRAL_ACTIVITY", activity: await parseMexcReferralXlsx(bytes, batch) };
  }
  async load(bytes: Uint8Array) { return readRawXlsx(bytes, this.contract); }
  async transform(records: RawRecord[], batch: ImportBatch, metadata: Record<string, string>): Promise<FileParseResult> {
    return { kind: "REFERRAL_ACTIVITY", activity: parseMexcRecords(records, batch, metadata.sheetName ?? "") };
  }
}

export class BybitAffiliateApiAdapter extends ApiSourceAdapter {
  readonly id = "bybit-affiliate-api";
  readonly exchangeSlug = "bybit";
  readonly datasetKind = "REFERRAL_ACTIVITY" as const;
  readonly accept = [] as string[];
  readonly uploadFields = [] as string[];
  readonly affectsCashback = false;
  readonly contract = bybitAffiliateContract;
  fetchDay = fetchAffiliateDay;
  mapRecords = mapAffiliateRecords;
}

export class MexcAffiliateApiAdapter extends ApiSourceAdapter {
  readonly id = "mexc-affiliate-api";
  readonly exchangeSlug = "mexc";
  readonly datasetKind = "REFERRAL_ACTIVITY" as const;
  readonly accept = [] as string[];
  readonly uploadFields = [] as string[];
  readonly affectsCashback = false;
  readonly contract = mexcAffiliateContract;
  fetchDay = fetchMexcDay;
  mapRecords = mapMexcRecords;
}

export function listFileAdapterDescriptors(): AdapterDescriptor[] {
  const active = new Map<string, FileSourceAdapter>();
  for (const adapter of ingestRegistry.values()) {
    if (!(adapter instanceof FileSourceAdapter)) continue;
    const key = [adapter.exchangeSlug, adapter.datasetKind, adapter.sourceMethod, adapter.format].join("|");
    const previous = active.get(key);
    if (!previous || compareVersions(adapter.contract.version, previous.contract.version) > 0) active.set(key, adapter);
  }
  return [...active.values()].map((adapter) => adapter.describe());
}

function compareVersions(left: string, right: string) {
  const a = Number(left.match(/@(\d+)$/)?.[1] ?? 0);
  const b = Number(right.match(/@(\d+)$/)?.[1] ?? 0);
  return a - b || left.localeCompare(right);
}

/** Uploads select the latest version; replay pins the batch's original version. */
export function resolveRegisteredFileAdapter(match: { exchangeSlug: string; datasetKind: string; sourceMethod: string; extension: string; contractVersion?: string | null; adapterId?: string | null }) {
  const candidates = [...ingestRegistry.values()].filter((adapter): adapter is FileSourceAdapter =>
    adapter instanceof FileSourceAdapter && adapter.exchangeSlug === match.exchangeSlug &&
    adapter.datasetKind === match.datasetKind && adapter.format === match.extension &&
    (!match.adapterId || adapter.id === match.adapterId) &&
    (!match.contractVersion || adapter.contract.version === match.contractVersion));
  const selected = candidates.filter((adapter) => adapter.sourceMethod === match.sourceMethod)
    .sort((a, b) => compareVersions(b.contract.version, a.contract.version))[0];
  if (selected) return { adapter: selected, mismatch: false };
  const alternative = candidates[0];
  return alternative ? { adapter: alternative, mismatch: true } : null;
}

export const ingestRegistry = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter) {
  assertContract(adapter.contract);
  if (adapter instanceof FileSourceAdapter && (adapter.accept.length !== 1 || adapter.accept[0]?.toLowerCase() !== `.${adapter.format.toLowerCase()}`)) {
    throw new Error(`Adapter ${adapter.id} accept must match .${adapter.format}`);
  }
  const key = adapter.key();
  const registryKey = [key.exchangeSlug, key.datasetKind, key.sourceMethod, key.format, key.contractVersion].join("|");
  if (ingestRegistry.has(registryKey)) throw new Error(`Duplicate adapter contract: ${registryKey}`);
  ingestRegistry.set(registryKey, adapter);
}

for (const adapter of [new BybitNormalizedCsvAdapter(), new MexcReferralXlsxAdapter(), new BybitAffiliateApiAdapter(), new MexcAffiliateApiAdapter()]) registerAdapter(adapter);

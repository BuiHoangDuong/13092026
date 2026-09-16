import { createHash } from "node:crypto";
import { parse } from "csv-parse/sync";
import { Prisma, type ImportBatch } from "@cashback/db";

export type NormalizedCommission = {
  uid: string; asset: string; amount: string; dedupKey: string;
  periodStart: string; periodEnd: string; reportType: "TRANSACTION" | "AGGREGATE";
  referralLinkId: string | null;
};
export type ParsedRow = { raw: Record<string, string>; normalized: NormalizedCommission | null; flags: string[] };
type Metadata = Pick<ImportBatch, "rootAccount" | "periodStart" | "periodEnd" | "sourceTz" | "reportType">;

/** Explicit Bybit normalized CSV v1; never guess proprietary export columns. */
export function parseBybitCsv(bytes: Uint8Array, batch: Metadata): ParsedRow[] {
  if (batch.sourceTz !== "UTC") throw new Error("Bybit CSV v1 requires UTC timestamps");
  const records = parse(Buffer.from(bytes), { bom: true, skip_empty_lines: true, trim: true,
    max_record_size: 16_384, columns: (headers: string[]) => {
      const allowed = ["uid", "asset", "commission", "transaction_id", "occurred_at", "referral_link_id"];
      if (new Set(headers).size !== headers.length || headers.some(h => !allowed.includes(h)) ||
          ["uid", "asset", "commission"].some(h => !headers.includes(h))) {
        throw new Error("Use Bybit CSV v1 headers: uid,asset,commission[,transaction_id,occurred_at,referral_link_id]");
      }
      return headers;
    }
  }) as Record<string, string>[];
  if (!records.length || records.length > 5000) throw new Error("Upload between 1 and 5000 rows per batch");
  const seen = new Set<string>();
  return records.map(raw => {
    const flags: string[] = [];
    const uid = raw.uid ?? "", asset = (raw.asset ?? "").toUpperCase(), amount = raw.commission ?? "";
    if (!/^\d{1,128}$/.test(uid)) flags.push("INVALID_UID");
    if (!/^[A-Z0-9]{1,16}$/.test(asset)) flags.push("INVALID_ASSET");
    if (!/^(?:0|[1-9]\d{0,19})(?:\.\d{1,10})?$/.test(amount)) flags.push("INVALID_COMMISSION");
    const transactionId = raw.transaction_id;
    const reportType = transactionId ? "TRANSACTION" : "AGGREGATE";
    if (batch.reportType === "AGGREGATE" && transactionId) flags.push("REPORT_TYPE_MISMATCH");
    if (transactionId && transactionId.length > 200) flags.push("INVALID_TRANSACTION_ID");
    let start = batch.periodStart.toISOString(), end = batch.periodEnd.toISOString();
    if (transactionId) {
      const timestamp = raw.occurred_at ?? "";
      const date = new Date(timestamp);
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp) || !Number.isFinite(date.getTime()) ||
          date.toISOString().slice(0, 19) !== timestamp.slice(0, 19) || date < batch.periodStart || date > batch.periodEnd) flags.push("INVALID_UTC_TIMESTAMP");
      else start = end = date.toISOString();
    } else if (raw.occurred_at) flags.push("MISSING_TRANSACTION_ID");
    const key = transactionId
      ? ["bybit-v1", batch.rootAccount, "transaction", transactionId, asset]
      : ["bybit-v1", batch.rootAccount, "aggregate", uid, asset, start, end];
    const dedupKey = createHash("sha256").update(JSON.stringify(key)).digest("hex");
    if (seen.has(dedupKey)) flags.push("DUPLICATE_KEY");
    seen.add(dedupKey);
    return { raw, flags, normalized: flags.length ? null : {
      uid, asset, amount: new Prisma.Decimal(amount).toFixed(10), dedupKey,
      periodStart: start, periodEnd: end, reportType, referralLinkId: raw.referral_link_id || null
    } };
  });
}

export const parserRegistry = { bybit: parseBybitCsv } as const;

import { createHash, createHmac } from "node:crypto";

export type DriftClass = "SAME" | "ADDITIVE" | "ALIASED" | "BREAKING";
export type FieldType = "uidText" | "text" | "decimal" | "decimalOrEmpty" | "assetMap";
export type FieldSpec = {
  target: string;
  source: string;
  aliases?: string[];
  type: FieldType;
  unit?: string;
  required: boolean;
};
export type FieldContract = { version: string; fields: FieldSpec[]; ignored: string[]; personal?: string[] };
export type DriftReport = { class: DriftClass; fields: string[]; fingerprint: string; contractVersion: string };

export const bybitCsvContract: FieldContract = {
  version: "bybit-csv@1",
  fields: [
    { target: "uid", source: "uid", type: "uidText", required: true },
    { target: "asset", source: "asset", type: "text", required: true },
    { target: "commission", source: "commission", type: "decimal", required: true },
    { target: "transaction_id", source: "transaction_id", type: "text", required: false },
    { target: "occurred_at", source: "occurred_at", type: "text", required: false },
    { target: "referral_link_id", source: "referral_link_id", type: "text", required: false }
  ],
  ignored: [], personal: []
};

export const mexcReferralContract: FieldContract = {
  version: "mexc-referral-xlsx@1",
  fields: [
    { target: "uid", source: "Referral", type: "uidText", required: true },
    { target: "TRADE_VOLUME", source: "Trading volume", type: "decimal", unit: "Trading token", required: true },
    { target: "tradingAsset", source: "Trading token", type: "text", required: true },
    { target: "REPORTED_COMMISSION", source: "Your Earnings", type: "decimal", unit: "Commission token", required: true },
    { target: "earningsAsset", source: "Commission token", type: "text", required: true },
    { target: "referralCode", source: "Referral Code", type: "text", required: false }
  ],
  ignored: [], personal: ["Nickname", "User tag", "Identification", "Identification level", "Asset band"]
};

export const bybitAffiliateContract: FieldContract = {
  version: "bybit-affiliate@1",
  fields: [
    { target: "uid", source: "userId", aliases: [], type: "uidText", required: true },
    { target: "referralCode", source: "source", aliases: [], type: "text", required: false },
    { target: "TRADE_VOLUME", source: "tradeVol", aliases: ["tradingVolume"], type: "decimalOrEmpty", unit: "USDT", required: true },
    { target: "TAKER_VOLUME", source: "takerVol", type: "decimalOrEmpty", unit: "USDT", required: true },
    { target: "MAKER_VOLUME", source: "makerVol", type: "decimalOrEmpty", unit: "USDT", required: true },
    { target: "TRADFI_VOLUME", source: "tradfiTradeVol", type: "decimalOrEmpty", unit: "USDT", required: true },
    { target: "REPORTED_COMMISSION", source: "commissionsVol", type: "assetMap", required: true }
  ],
  // Known fields that are never stored (Req 6.20). The rolling 30/365-day values and
  // the per-row date echo are always present in aff-user-list, so leaving them out
  // would report ADDITIVE drift on every run.
  personal: ["remarks", "isKyc", "KycLevel", "depositAmount30Day", "depositAmount365Day", "totalWalletBalance", "vipLevel", "paySendAmount30Day", "payFtt", "cardFtt", "registerTime"],
  ignored: [
    "remarks", "isKyc", "registerTime", "startDate", "endDate",
    "takerVol30Day", "makerVol30Day", "tradeVol30Day", "takerVol365Day", "makerVol365Day", "tradeVol365Day",
    "tradfiTradeVol30Day", "tradfiTradeVol365Day", "commissions30Day", "commissions365Day",
    "depositAmount30Day", "depositAmount365Day", "totalWalletBalance", "KycLevel", "vipLevel",
    "paySendAmount30Day", "payFtt", "cardFtt"
  ]
};

/** Normalized targets a contract may map to. A new target needs a sink change first. */
export const KNOWN_TARGETS: ReadonlySet<string> = new Set([
  "uid", "asset", "commission", "transaction_id", "occurred_at", "referral_link_id", "referralCode", "tradingAsset", "earningsAsset",
  "TRADE_VOLUME", "TAKER_VOLUME", "MAKER_VOLUME", "TRADFI_VOLUME", "REPORTED_COMMISSION"
]);

export function assertContract(contract: FieldContract) {
  const unknown = contract.fields.filter((field) => !KNOWN_TARGETS.has(field.target));
  if (unknown.length) throw new Error(`Unknown contract targets: ${unknown.map((field) => field.target).join(", ")}`);
  if (contract.personal?.some((name) => contract.fields.some((field) => field.source === name))) throw new Error("A mapped field cannot be personal");
}

export function schemaFingerprint(names: string[], contract: FieldContract) {
  const types = new Map<string, string>();
  for (const field of contract.fields) {
    types.set(field.source, field.type);
    for (const alias of field.aliases ?? []) types.set(alias, field.type);
  }
  for (const name of [...contract.ignored, ...(contract.personal ?? [])]) types.set(name, "ignored");
  const pairs = [...new Set(names)].sort().map((name) => `${name}:${types.get(name) ?? "unknown"}`);
  return createHash("sha256").update(pairs.join("\n")).digest("hex");
}

export function classifyHeaders(names: string[], contract: FieldContract, previousFingerprint?: string | null): DriftReport {
  const present = new Set(names);
  const known = new Set<string>([...contract.fields.flatMap((field) => [field.source, ...(field.aliases ?? [])]), ...contract.ignored, ...(contract.personal ?? [])]);
  const extra = [...present].filter((name) => !known.has(name)).sort();
  const aliased: string[] = [];
  const missing: string[] = [];
  for (const field of contract.fields) {
    if (!field.required || present.has(field.source)) continue;
    const alias = (field.aliases ?? []).find((name) => present.has(name));
    if (alias) aliased.push(`${field.source}->${alias}`);
    else missing.push(field.source);
  }
  const fingerprint = schemaFingerprint(names, contract);
  const driftClass: DriftClass = missing.length ? "BREAKING" : aliased.length ? "ALIASED" : extra.length ? "ADDITIVE" : previousFingerprint && previousFingerprint !== fingerprint ? "ADDITIVE" : "SAME";
  return { class: driftClass, fields: [...missing, ...aliased, ...extra], fingerprint, contractVersion: contract.version };
}

export function canonicalizeRecord(record: Record<string, unknown>, contract: FieldContract) {
  const normalized = { ...record };
  for (const field of contract.fields) {
    if (field.source in normalized) continue;
    const alias = field.aliases?.find((name) => name in normalized);
    if (alias) normalized[field.source] = normalized[alias];
  }
  return normalized;
}

export type MetricDraft = {
  uid: string;
  referralCode: string | null;
  kind: "TRADE_VOLUME" | "TAKER_VOLUME" | "MAKER_VOLUME" | "TRADFI_VOLUME" | "REPORTED_COMMISSION";
  asset: string;
  valueState: "VALUE" | "EMPTY";
  amount: string | null;
};

export function activityDigest(rows: MetricDraft[]) {
  const lines = rows.map((row) => [row.uid, row.referralCode ?? "", row.kind, row.asset, row.valueState, row.amount ?? ""].join("|")).sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

export function signBybit(secret: string, timestamp: string, apiKey: string, recvWindow: string, query: string) {
  return createHmac("sha256", secret).update(`${timestamp}${apiKey}${recvWindow}${query}`).digest("hex");
}

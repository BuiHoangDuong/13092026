/** Exact decimal arithmetic for estimates only. Never used to mutate a wallet. */
const SCALE = 100_000_000n;
function decimal(value: string, maximum: bigint): bigint | null {
  // Trailing zeros carry no precision, so DB rates like "0.3000000000" stay valid.
  const match = /^(\d{1,16})(?:\.(\d{1,8}))?$/.exec(value.trim().replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, ""));
  if (!match) return null;
  const scaled = BigInt(match[1]!) * SCALE + BigInt((match[2] ?? "").padEnd(8, "0"));
  return scaled <= maximum * SCALE ? scaled : null;
}
function money(numerator: bigint, denominator: bigint): string {
  const cents = (numerator * 100n + denominator / 2n) / denominator;
  return `${(cents / 100n).toLocaleString("en-US")}.${String(cents % 100n).padStart(2, "0")}`;
}
/** Share rate "0.07" -> "7" without float artifacts; null unless the rate is within 0–1. */
export function sharePercent(rate: string): string | null {
  const share = decimal(rate, 1n);
  if (share === null) return null;
  const percent = share * 100n;
  const fraction = String(percent % SCALE).padStart(8, "0").replace(/0+$/, "");
  return `${percent / SCALE}${fraction ? `.${fraction}` : ""}`;
}
export function calculateOpportunity(fees: string, commissionPercent: string, shareRate: string) {
  const fee = decimal(fees, 1_000_000n);
  const commission = decimal(commissionPercent, 100n);
  const share = decimal(shareRate, 1n);
  if (fee === null || commission === null || share === null) return null;
  const base = fee * commission;
  const numerator = base * share;
  const denominator = 100n * SCALE ** 3n;
  return {
    fees: money(fee, SCALE), commission: money(base, 100n * SCALE ** 2n),
    monthly: money(numerator, denominator), annual: money(numerator * 12n, denominator),
    zero: numerator === 0n
  };
}

/** Accept plain decimal or properly grouped en-US text; never reinterpret malformed grouping. */
export function normalizeVolume(value: string): string | null {
  const text = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/.test(text)) return null;
  return text.replace(/,/g, "");
}

export function formatVolume(value: string): string {
  const plain = normalizeVolume(value);
  if (plain === null) return value;
  const [whole, fraction] = plain.split(".");
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
}

/** Volume 1e8 × exchange commission 1e10 × offer share 1e4; round only final outputs. */
export function calculateVolumeEstimate(volume: string, commissionVolumeRate: string, cashbackRate: string) {
  const normalized = normalizeVolume(volume);
  const notional = normalized?.match(/^(\d{1,16})(?:\.(\d{1,8}))?$/);
  const factor = /^(?:0(?:\.\d{1,10})?|1(?:\.0{1,10})?)$/.test(commissionVolumeRate) ? commissionVolumeRate.split(".") : null;
  const share = /^(?:0(?:\.\d{1,4})?|1(?:\.0{1,4})?)$/.test(cashbackRate) ? cashbackRate.split(".") : null;
  if (!notional || !factor || !share) return null;
  const volumeUnits = BigInt(notional[1]!) * SCALE + BigInt((notional[2] ?? "").padEnd(8, "0"));
  const rateUnits = BigInt(factor[0]!) * 10_000_000_000n + BigInt((factor[1] ?? "").padEnd(10, "0"));
  const shareUnits = BigInt(share[0]!) * 10_000n + BigInt((share[1] ?? "").padEnd(4, "0"));
  const combinedRate = rateUnits * shareUnits;
  const numerator = volumeUnits * combinedRate;
  const percentScale = 10n ** 12n;
  const percentFraction = String(combinedRate % percentScale).padStart(12, "0").replace(/0+$/, "");
  return { volume: formatVolume(normalized!), ratePercent: `${combinedRate / percentScale}${percentFraction ? `.${percentFraction}` : ""}`,
    monthly: money(numerator, 10n ** 22n), annual: money(numerator * 12n, 10n ** 22n), zero: numerator === 0n };
}

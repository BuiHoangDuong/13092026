/**
 * INTERIM MARKETING SET — not real transactions, not real users (Req 17.3).
 *
 * Home Online Rebate Ledger shows exactly 100 deterministic fake credits with
 * large USDT amounts so the ticker looks busy. Do not wire this to WalletEntry
 * until the operator switches to live credits (Req 17.7). Keep the illustrative
 * badge next to the table.
 */

export type LedgerDemoRow = {
  exchange: string;
  ratePercent: number;
  maskedUid: string;
  rebateAmount: string;
  asset: string;
  date: string;
};

const DEMO_EXCHANGES = ["Binance", "MEXC", "Bybit"] as const;
const DEMO_RATES = [40, 35, 30] as const;

function maskedUid(seed: number): string {
  const digits = String(1000 + ((seed * 7919) % 9000));
  return `***${digits}`;
}

function rebateAmount(seed: number): string {
  const headline = seed % 11 === 0;
  const value = headline
    ? 3200 + ((seed * 97) % 5300) + (seed % 9) / 10
    : 480 + ((seed * 83) % 2100) + (seed % 13) / 10;
  return value.toFixed(2);
}

function rebateDate(seed: number, end = "2026-09-17"): string {
  const endUtc = Date.parse(`${end}T00:00:00.000Z`);
  const daysBack = seed % 30;
  return new Date(endUtc - daysBack * 86_400_000).toISOString().slice(0, 10);
}

export function generateLedgerDemoRows(count = 100, endDate = "2026-09-17"): LedgerDemoRow[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = i + 1;
    const exchangeIndex = seed % DEMO_EXCHANGES.length;
    return {
      exchange: DEMO_EXCHANGES[exchangeIndex]!,
      ratePercent: DEMO_RATES[exchangeIndex]!,
      maskedUid: maskedUid(seed),
      rebateAmount: rebateAmount(seed),
      asset: "USDT",
      date: rebateDate(seed, endDate)
    };
  });
}

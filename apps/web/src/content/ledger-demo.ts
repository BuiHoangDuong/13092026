/**
 * DEMO / ILLUSTRATIVE ONLY — not real transactions, not real users.
 *
 * This powers a preview of the future "rebate ledger" table (real data lands once
 * import + attribution + wallet, i.e. Tasks 10-14, are implemented and reading from
 * `WalletEntry`/`CommissionRecord`). Until then this file is the ONLY source for the
 * table; do not wire it to any live customer/UID/amount data.
 *
 * Rows are deterministically generated (not hand-typed fake amounts) so nothing here
 * resembles a specific real payout. The UI must keep the "illustrative example" label
 * shown alongside this data — see ledgerDemoBadge in the message catalog.
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

function maskedUid(seed: number): string {
  const digits = String(100 + (seed * 37) % 900);
  return `***${digits}***`;
}

function rebateAmount(seed: number): string {
  // Deterministic pseudo-amount in a plausible range, not tied to any real payout.
  const value = 20 + ((seed * 53) % 400) + (seed % 7) / 10;
  return value.toFixed(2);
}

export function generateLedgerDemoRows(count = 20, isoDate = "2026-09-15"): LedgerDemoRow[] {
  return Array.from({ length: count }, (_, i) => {
    const seed = i + 1;
    return {
      exchange: DEMO_EXCHANGES[seed % DEMO_EXCHANGES.length]!,
      ratePercent: [40, 35, 30][seed % 3]!,
      maskedUid: maskedUid(seed),
      rebateAmount: rebateAmount(seed),
      asset: "USDT",
      date: isoDate
    };
  });
}

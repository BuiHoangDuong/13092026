// Internal USDT payout policy (Req 22.26-22.38). Pure functions: no DB, no network, no signing.
// Amounts are decimal strings; arithmetic uses BigInt at the Decimal(30,10) scale of the wallet.
export const INTERNAL_USDT_POLICY = {
  version: "internal-usdt@1",
  valuationMode: "FIXED_USDT_USD",
  usdtPerUsd: "1",
  autoApproveMaxUsd: "20",
  minimumExclusiveUsd: "0.5",
  slotHourUtc: 23
} as const;

const SCALE = 10;
const UNIT = 10n ** BigInt(SCALE);

export function toScaled(value: string): bigint {
  const match = /^(\d{1,20})(?:\.(\d{1,10}))?$/.exec(value.trim());
  if (!match) throw new Error("INVALID_DECIMAL");
  return BigInt(match[1]!) * UNIT + BigInt((match[2] ?? "").padEnd(SCALE, "0"));
}
export function fromScaled(value: bigint): string {
  const whole = value / UNIT, fraction = (value % UNIT).toString().padStart(SCALE, "0");
  return `${whole}.${fraction}`;
}
export function sumDecimals(values: string[]): string {
  return fromScaled(values.reduce((total, value) => total + toScaled(value), 0n));
}

export type ExecutionDecision = "MINIMUM_NOT_MET" | "AUTO" | "AWAITING_APPROVAL";

/** Req 22.6/22.34/22.36: threshold on the merged principal, fixed 1 USDT = 1 USD, fees excluded. */
export function decideExecution(totalPrincipalUsdt: string): ExecutionDecision {
  const total = toScaled(totalPrincipalUsdt);
  if (total <= toScaled(INTERNAL_USDT_POLICY.minimumExclusiveUsd)) return "MINIMUM_NOT_MET";
  return total <= toScaled(INTERNAL_USDT_POLICY.autoApproveMaxUsd) ? "AUTO" : "AWAITING_APPROVAL";
}

/** Next 23:00 UTC slot strictly after `at` (Req 22.26-22.28: approval, missed slot and retry all wait for it). */
export function nextSlotAfter(at: Date): Date {
  const slot = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), INTERNAL_USDT_POLICY.slotHourUtc);
  return new Date(slot > at.getTime() ? slot : slot + 24 * 3_600_000);
}
/** Slot that owns `now`: the most recent 23:00 UTC at or before it (cutoff for the batch list, Req 22.30). */
export function currentSlotAt(now: Date): Date {
  const slot = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), INTERNAL_USDT_POLICY.slotHourUtc);
  return new Date(slot <= now.getTime() ? slot : slot - 24 * 3_600_000);
}
export const earliestSendAfterApproval = nextSlotAfter;
export const earliestRetryAfterConfirmedFailure = nextSlotAfter;

/** Dispatch is allowed only while a slot is running; a stale or recovered job never sends off-schedule (Req 22.28). */
export function mayDispatchNow(now: Date, slot: Date, windowMs = 3_600_000): boolean {
  const age = now.getTime() - slot.getTime();
  return age >= 0 && age < windowMs && currentSlotAt(now).getTime() === slot.getTime();
}

/** Req 22.23: primaryReason order. */
export const BLOCKER_PRIORITY = [
  "RECONCILIATION_REQUIRED", "DISPATCHING",
  "SYNC_PENDING", "SYNC_FAILED", "CORRECTION_PENDING", "INVARIANT_VIOLATION",
  "RECIPIENT_NOT_READY", "DESTINATION_REQUIRED", "CONFIG_MISSING", "RECEIVABLE_OUTSTANDING",
  "AWAITING_APPROVAL",
  "WAITING_SCHEDULE",
  "INSUFFICIENT_SOURCE_FUNDS", "LIMIT_EXCEEDED", "MINIMUM_NOT_MET", "FEE_NOT_READY",
  "TECHNICAL_ERROR",
  "READY"
] as const;
export type Blocker = (typeof BLOCKER_PRIORITY)[number];

export function primaryReason(blockers: readonly Blocker[]): Blocker {
  const active = blockers.filter(blocker => blocker !== "READY");
  if (!active.length) return "READY";
  return [...active].sort((a, b) => BLOCKER_PRIORITY.indexOf(a) - BLOCKER_PRIORITY.indexOf(b))[0]!;
}
/** SEND is allowed only when every blocker is cleared; approval never overrides another blocker. */
export const canSend = (blockers: readonly Blocker[]): boolean => primaryReason(blockers) === "READY";

export type PayableCommand = "APPROVE" | "SEND" | "RETRY" | "RECONCILE" | "CANCEL";
export function commandAllowed(command: PayableCommand, blockers: readonly Blocker[], approvalCurrent = true): boolean {
  const inFlight = blockers.includes("DISPATCHING") || blockers.includes("RECONCILIATION_REQUIRED");
  switch (command) {
    case "RECONCILE": return inFlight;
    case "CANCEL": return !blockers.includes("DISPATCHING") && !blockers.includes("RECONCILIATION_REQUIRED");
    case "APPROVE": return !inFlight && approvalCurrent;
    case "SEND": case "RETRY": return canSend(blockers);
  }
}

export type ApprovalSnapshot = { amount: string; asset: string; destination: string; payableVersion: number };
/** Req 22.5/22.29: any change of amount, asset, destination or version voids the old approval. */
export function approvalStillValid(approved: ApprovalSnapshot, current: ApprovalSnapshot): boolean {
  return toScaled(approved.amount) === toScaled(current.amount) && approved.asset === current.asset
    && approved.destination === current.destination && approved.payableVersion === current.payableVersion;
}

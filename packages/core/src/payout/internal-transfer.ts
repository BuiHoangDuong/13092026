// Internal USDT transfer port (Req 22.25). No concrete MEXC/Bybit adapter ships yet: a real adapter needs a verified
// payout account and key (see docs/exchange-uid-payout-research.md). Until one is registered the worker never dispatches.
export type TransferOutcome = {
  /** SUCCESS: provider proved the transfer. NOT_SENT: provider proved it never left. PENDING: accepted, not final. UNKNOWN: no proof either way. */
  outcome: "SUCCESS" | "NOT_SENT" | "PENDING" | "UNKNOWN";
  providerRef?: string;
  paidAmount?: string;
  toUid?: string;
  code?: string;
};
export type RecipientStatus = "READY" | "SETUP_REQUIRED" | "UNKNOWN";

export interface InternalTransferPort {
  readonly exchangeSlug: string;
  readonly sourceAccountId: string;
  recipientStatus(uid: string): Promise<RecipientStatus>;
  /** Spendable USDT on the payout account (not the affiliate account). */
  availableBalance(): Promise<string>;
  /** Operator-borne fee for transferring `principal`; the customer always receives the full principal (Req 22.33). */
  estimateFee(principal: string): Promise<string>;
  /** Idempotent on dispatchKey: the same key must never move money twice. */
  transfer(request: { dispatchKey: string; toUid: string; amount: string }): Promise<TransferOutcome>;
  lookup(dispatchKey: string): Promise<TransferOutcome>;
}

const ports = new Map<string, InternalTransferPort>();
export const registerInternalTransferPort = (port: InternalTransferPort) => { ports.set(port.exchangeSlug, port); };
export const getInternalTransferPort = (exchangeSlug: string) => ports.get(exchangeSlug) ?? null;
export const clearInternalTransferPorts = () => { ports.clear(); };
/** Exchanges whose payout channel is in scope (Req 22.25). Binance is excluded until Payout rights are verified. */
export const PAYOUT_EXCHANGES = ["mexc", "bybit"] as const;

export type SimulatedBehavior = "SUCCESS" | "NOT_SENT" | "TIMEOUT_SENT" | "TIMEOUT_NOT_SENT" | "PENDING_THEN_SUCCESS" | "SHORT_PAY" | "WRONG_UID";

/** In-memory exchange double for tests and local simulation. It never touches a network. */
export class SimulatedInternalTransfer implements InternalTransferPort {
  balance: number;
  fee = "0.0000000000";
  feeFails = false;
  recipients = new Map<string, RecipientStatus>();
  defaultRecipient: RecipientStatus = "READY";
  behavior: SimulatedBehavior = "SUCCESS";
  behaviorByUid = new Map<string, SimulatedBehavior>();
  /** Actual money movements, keyed by dispatchKey: the exchange's own truth. */
  readonly sent = new Map<string, { toUid: string; amount: string; providerRef: string; settled: boolean }>();
  readonly calls: Array<{ dispatchKey: string; toUid: string; amount: string }> = [];
  lookupProvesNotSent = true;
  private seq = 0;
  constructor(public readonly exchangeSlug: string, public readonly sourceAccountId: string, balance: number) { this.balance = balance; }
  async recipientStatus(uid: string) { return this.recipients.get(uid) ?? this.defaultRecipient; }
  async availableBalance() { return this.balance.toFixed(10); }
  async estimateFee(principal: string) { if (this.feeFails) throw new Error("FEE_UNAVAILABLE"); void principal; return this.fee; }
  async transfer(request: { dispatchKey: string; toUid: string; amount: string }): Promise<TransferOutcome> {
    this.calls.push(request);
    const existing = this.sent.get(request.dispatchKey);
    if (existing) return { outcome: existing.settled ? "SUCCESS" : "PENDING", providerRef: existing.providerRef, paidAmount: existing.amount, toUid: existing.toUid };
    const behavior = this.behaviorByUid.get(request.toUid) ?? this.behavior;
    const move = (toUid: string, amount: string, settled: boolean) => {
      const providerRef = `sim-${this.exchangeSlug}-${++this.seq}`;
      this.sent.set(request.dispatchKey, { toUid, amount, providerRef, settled });
      this.balance -= Number(amount);
      return providerRef;
    };
    switch (behavior) {
      case "NOT_SENT": return { outcome: "NOT_SENT", code: "PROVIDER_REJECTED" };
      case "TIMEOUT_NOT_SENT": throw new Error("TIMEOUT");
      case "TIMEOUT_SENT": move(request.toUid, request.amount, true); throw new Error("TIMEOUT");
      case "PENDING_THEN_SUCCESS": return { outcome: "PENDING", providerRef: move(request.toUid, request.amount, false) };
      case "SHORT_PAY": { const short = (Number(request.amount) - 1).toFixed(10); return { outcome: "SUCCESS", providerRef: move(request.toUid, short, true), paidAmount: short, toUid: request.toUid }; }
      case "WRONG_UID": return { outcome: "SUCCESS", providerRef: move("000-wrong", request.amount, true), paidAmount: request.amount, toUid: "000-wrong" };
      default: return { outcome: "SUCCESS", providerRef: move(request.toUid, request.amount, true), paidAmount: request.amount, toUid: request.toUid };
    }
  }
  async lookup(dispatchKey: string): Promise<TransferOutcome> {
    const sent = this.sent.get(dispatchKey);
    if (!sent) return this.lookupProvesNotSent ? { outcome: "NOT_SENT" } : { outcome: "UNKNOWN" };
    if (!sent.settled) { sent.settled = true; return { outcome: "SUCCESS", providerRef: sent.providerRef, paidAmount: sent.amount, toUid: sent.toUid }; }
    return { outcome: "SUCCESS", providerRef: sent.providerRef, paidAmount: sent.amount, toUid: sent.toUid };
  }
}

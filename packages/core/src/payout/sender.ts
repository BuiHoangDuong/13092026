// Port for on-chain payout senders (Req 21, draft). Implementations (EVM, Solana) are
// added only after the design decisions in requirements Open decisions #26–32 are made.
import type { AutoPayoutNetwork } from "./config.js";

export type PayoutTransferRequest = {
  intentId: string;          // stable per withdrawal; the idempotency anchor
  network: AutoPayoutNetwork;
  to: string;
  amountBaseUnits: bigint;   // wei / lamports, converted without floats
};
export type PreparedPayout = {
  intentId: string;
  network: AutoPayoutNetwork;
  /** Data persisted before broadcast so recovery can reconcile (EVM nonce + hash; Solana signature + lastValidBlockHeight). */
  recovery: Record<string, string>;
  serialized: string;
};
export type PayoutTxStatus = "NOT_FOUND" | "PENDING" | "CONFIRMED" | "FAILED";

export interface PayoutSender {
  readonly network: AutoPayoutNetwork;
  prepare(request: PayoutTransferRequest): Promise<PreparedPayout>;
  broadcast(prepared: PreparedPayout): Promise<{ txRef: string }>;
  lookup(prepared: PreparedPayout): Promise<PayoutTxStatus>;
}

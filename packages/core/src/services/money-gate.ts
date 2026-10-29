import { db, Prisma, type MoneyFlowMode } from "@cashback/db";
import { lockCashback } from "./jobs.js";
import { PublicAccessError } from "./rate-limit.js";

/** Req 22.24: every money writer reads the gate inside its own transaction; missing/unknown mode fails closed. */
export async function readMoneyFlowMode(tx: Prisma.TransactionClient): Promise<MoneyFlowMode> {
  const gate = await tx.moneyFlowGate.findUnique({ where: { id: 1 } });
  if (!gate || !["LEGACY", "FROZEN", "PAYABLE_ONLY"].includes(gate.mode)) throw new PublicAccessError("MONEY_FLOW_GATE_UNKNOWN", "Money flow is temporarily unavailable", 503);
  return gate.mode;
}
export async function assertMoneyFlowMode(tx: Prisma.TransactionClient, allowed: MoneyFlowMode[]) {
  const mode = await readMoneyFlowMode(tx);
  if (!allowed.includes(mode)) throw new PublicAccessError("MONEY_FLOW_CLOSED", mode === "PAYABLE_ONLY" ? "Customer withdrawals are replaced by scheduled payouts" : "Money flow is frozen for cutover", 409);
  return mode;
}

const allowedTransitions: Record<MoneyFlowMode, MoneyFlowMode[]> = { LEGACY: ["FROZEN"], FROZEN: ["LEGACY", "PAYABLE_ONLY"], PAYABLE_ONLY: ["FROZEN"] };
const legacyOpen = ["REQUESTED", "UNDER_REVIEW", "APPROVED", "AUTO_APPROVED"] as const;

/** Admin cutover step (Req 22.24). The exclusive barrier is the global ledger lock every money transaction already takes. */
export async function setMoneyFlowMode(adminId: string, mode: MoneyFlowMode) {
  return db.$transaction(async tx => {
    await lockCashback(tx);
    const current = await readMoneyFlowMode(tx);
    if (current === mode) return { mode, version: (await tx.moneyFlowGate.findUniqueOrThrow({ where: { id: 1 } })).version };
    if (!allowedTransitions[current].includes(mode)) throw new PublicAccessError("INVALID_GATE_TRANSITION", `Cannot move ${current} -> ${mode}`, 409);
    if (mode === "LEGACY" && await tx.payoutExecution.findFirst({ select: { id: true } })) throw new PublicAccessError("INVALID_GATE_TRANSITION", "Cannot return to LEGACY after payable executions exist", 409);
    if (mode === "PAYABLE_ONLY") {
      if (await tx.withdrawal.findFirst({ where: { status: { in: [...legacyOpen] } }, select: { id: true } })) throw new PublicAccessError("LEGACY_IN_FLIGHT", "Legacy withdrawals must be drained or reconciled first", 409);
      const scopes = await tx.payableSyncScope.findMany({ where: { OR: [{ state: { not: "SYNCED" } }, { invariantError: { not: null } }] }, select: { uidAccountId: true } });
      if (scopes.length) throw new PublicAccessError("RECONCILIATION_REQUIRED", "Payable ledger is not reconciled for every scope", 409);
    }
    const gate = await tx.moneyFlowGate.update({ where: { id: 1 }, data: { mode, version: { increment: 1 }, updatedBy: adminId } });
    return { mode: gate.mode, version: gate.version };
  });
}

import test from "node:test";
import assert from "node:assert/strict";
import {
  decideExecution, nextSlotAfter, currentSlotAt, mayDispatchNow, primaryReason, canSend, commandAllowed,
  approvalStillValid, sumDecimals, INTERNAL_USDT_POLICY
} from "../dist/index.js";

test("threshold: <=0.5 accumulates, (0.5, 20] auto, >20 needs approval (Req 22.6, 22.36)", () => {
  assert.equal(decideExecution("0"), "MINIMUM_NOT_MET");
  assert.equal(decideExecution("0.5"), "MINIMUM_NOT_MET");
  assert.equal(decideExecution("0.5000000001"), "AUTO");
  assert.equal(decideExecution("8"), "AUTO");
  assert.equal(decideExecution("20"), "AUTO");
  assert.equal(decideExecution("20.0000000001"), "AWAITING_APPROVAL");
  assert.equal(decideExecution("35"), "AWAITING_APPROVAL");
});

test("merged total is judged, not each line (3 + 5 + 7, and 25 + 5)", () => {
  assert.equal(sumDecimals(["3", "5", "7"]), "15.0000000000");
  assert.equal(decideExecution(sumDecimals(["12", "9"])), "AWAITING_APPROVAL");
  assert.equal(decideExecution(sumDecimals(["25", "5"])), "AWAITING_APPROVAL");
  assert.throws(() => decideExecution("-1"), /INVALID_DECIMAL/);
  assert.throws(() => decideExecution("1e3"), /INVALID_DECIMAL/);
});

test("23:00 UTC slots: approval, missed slot and retry wait for the next one (Req 22.27, 22.28, 22.31)", () => {
  assert.equal(nextSlotAfter(new Date("2026-10-17T23:05:00Z")).toISOString(), "2026-10-18T23:00:00.000Z");
  assert.equal(nextSlotAfter(new Date("2026-10-18T01:00:00Z")).toISOString(), "2026-10-18T23:00:00.000Z");
  assert.equal(nextSlotAfter(new Date("2026-10-17T23:00:00Z")).toISOString(), "2026-10-18T23:00:00.000Z");
  assert.equal(nextSlotAfter(new Date("2026-12-31T23:30:00Z")).toISOString(), "2027-01-01T23:00:00.000Z");
  assert.equal(currentSlotAt(new Date("2026-10-18T01:00:00Z")).toISOString(), "2026-10-17T23:00:00.000Z");
  assert.equal(INTERNAL_USDT_POLICY.valuationMode, "FIXED_USDT_USD");
});

test("a recovered job does not dispatch off-schedule", () => {
  const slot = new Date("2026-10-17T23:00:00Z");
  assert.equal(mayDispatchNow(new Date("2026-10-17T23:10:00Z"), slot), true);
  assert.equal(mayDispatchNow(new Date("2026-10-18T01:00:00Z"), slot), false);
  assert.equal(mayDispatchNow(new Date("2026-10-17T22:59:59Z"), slot), false);
});

test("blocker priority follows Req 22.23 and approval cannot override another blocker", () => {
  assert.equal(primaryReason([]), "READY");
  assert.equal(primaryReason(["AWAITING_APPROVAL", "INSUFFICIENT_SOURCE_FUNDS"]), "AWAITING_APPROVAL");
  assert.equal(primaryReason(["INSUFFICIENT_SOURCE_FUNDS", "TECHNICAL_ERROR"]), "INSUFFICIENT_SOURCE_FUNDS");
  assert.equal(primaryReason(["WAITING_SCHEDULE", "AWAITING_APPROVAL", "SYNC_PENDING"]), "SYNC_PENDING");
  assert.equal(primaryReason(["SYNC_FAILED", "RECONCILIATION_REQUIRED"]), "RECONCILIATION_REQUIRED");
  assert.equal(canSend(["READY"]), true);
  assert.equal(canSend(["WAITING_SCHEDULE"]), false);
});

test("commands: reconcile only in flight, cancel only before DISPATCHING, send needs all blockers cleared", () => {
  assert.equal(commandAllowed("RECONCILE", ["RECONCILIATION_REQUIRED"]), true);
  assert.equal(commandAllowed("RECONCILE", []), false);
  assert.equal(commandAllowed("CANCEL", ["DISPATCHING"]), false);
  assert.equal(commandAllowed("CANCEL", ["AWAITING_APPROVAL"]), true);
  assert.equal(commandAllowed("APPROVE", ["AWAITING_APPROVAL"], true), true);
  assert.equal(commandAllowed("APPROVE", ["AWAITING_APPROVAL"], false), false);
  assert.equal(commandAllowed("APPROVE", ["RECONCILIATION_REQUIRED"]), false);
  assert.equal(commandAllowed("SEND", ["AWAITING_APPROVAL"]), false);
  assert.equal(commandAllowed("RETRY", []), true);
});

test("approval is void when amount, asset, destination or version changes", () => {
  const base = { amount: "25", asset: "USDT", destination: "uid:1", payableVersion: 3 };
  assert.equal(approvalStillValid(base, { ...base, amount: "25.0000000000" }), true);
  assert.equal(approvalStillValid(base, { ...base, amount: "30" }), false);
  assert.equal(approvalStillValid(base, { ...base, destination: "uid:2" }), false);
  assert.equal(approvalStillValid(base, { ...base, payableVersion: 4 }), false);
});

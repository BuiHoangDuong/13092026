import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@cashback/db";
import { commissionForLookup, creditedCommissionByRecord } from "../dist/index.js";

const amount = (value) => new Prisma.Decimal(value);
const at = (iso) => new Date(iso);
const version = (id, commissionId, value, importedAt) => ({ id, commissionId, amount: amount(value), importedAt: at(importedAt) });

test("lookup commission stays on the latest applied version by importedAt", () => {
  const versions = [
    version("v1", "c1", "100", "2026-09-01T00:00:00Z"),
    version("v2", "c1", "200", "2026-09-02T00:00:00Z")
  ];
  const pending = creditedCommissionByRecord(versions, [{ sourceRef: "v1" }]);
  assert.equal(pending.get("c1").toFixed(10), "100.0000000000");
  const applied = creditedCommissionByRecord(versions, [{ sourceRef: "v1" }, { sourceRef: "v2" }]);
  assert.equal(applied.get("c1").toFixed(10), "200.0000000000");
});

test("equal importedAt uses version id descending, not input order", () => {
  const versions = [
    version("v-a", "c1", "100", "2026-09-01T00:00:00Z"),
    version("v-b", "c1", "200", "2026-09-01T00:00:00Z")
  ];
  const amounts = creditedCommissionByRecord(versions, [
    { sourceRef: "v-a" },
    { sourceRef: "v-b" }
  ]);
  assert.equal(amounts.get("c1").toFixed(10), "200.0000000000");
});

test("lookup ignores wallet entries that do not reference these versions", () => {
  const versions = [version("v1", "c1", "100", "2026-09-01T00:00:00Z")];
  const amounts = creditedCommissionByRecord(versions, [{ sourceRef: "release-entry" }, { sourceRef: null }]);
  assert.equal(amounts.has("c1"), false);
});

test("no applied wallet entry does not surface an in-flight reconciled amount", () => {
  const versions = [version("v-new", "c1", "200", "2026-09-02T00:00:00Z")];
  const amounts = creditedCommissionByRecord(versions, []);
  assert.equal(amounts.has("c1"), false);
  assert.equal(commissionForLookup(amounts.get("c1")).toFixed(10), "0.0000000000");
  assert.notEqual(commissionForLookup(amounts.get("c1")).toFixed(10), "200.0000000000");
});

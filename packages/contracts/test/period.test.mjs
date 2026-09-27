import test from "node:test";
import assert from "node:assert/strict";
import { inclusivePeriodUtc, wallDateTimeToUtc, wallTimeToUtc } from "../dist/index.js";

test("inclusive period converts source timezone to UTC", () => {
  assert.deepEqual(inclusivePeriodUtc("2026-09-18", "2026-09-25", "UTC"), {
    periodStart: "2026-09-18T00:00:00.000Z", periodEnd: "2026-09-25T23:59:59.999Z"
  });
  assert.deepEqual(inclusivePeriodUtc("2026-09-18", "2026-09-25", "Asia/Ho_Chi_Minh"), {
    periodStart: "2026-09-17T17:00:00.000Z", periodEnd: "2026-09-25T16:59:59.999Z"
  });
  assert.equal(wallDateTimeToUtc("2026-09-25T14:22:39", "Asia/Ho_Chi_Minh"), "2026-09-25T07:22:39.000Z");
});

test("missing local times and unknown zones are rejected", () => {
  assert.throws(() => wallTimeToUtc("2026-03-08", 2, 30, 0, 0, "America/New_York"));
  assert.throws(() => inclusivePeriodUtc("2026-09-18", "2026-09-25", "Not/AZone"));
  assert.throws(() => inclusivePeriodUtc("2026-09-25", "2026-09-18", "UTC"));
});

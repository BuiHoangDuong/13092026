import assert from "node:assert/strict";
import test from "node:test";
import { calculateOpportunity, sharePercent } from "../src/lib/opportunity.ts";

test("eligible commission and cashback share are separate factors", () => {
  for (const [rate, monthly, annual] of [["0.3", "75.00", "900.00"], ["0.4", "100.00", "1,200.00"], ["0.35", "87.50", "1,050.00"]]) {
    const result = calculateOpportunity("500", "50", rate!);
    assert.equal(result?.commission, "250.00");
    assert.equal(result?.monthly, monthly);
    assert.equal(result?.annual, annual);
  }
});
test("decimal products round half-up only at the final display", () => {
  assert.equal(calculateOpportunity("0.05", "100", "0.1")?.monthly, "0.01");
  assert.equal(calculateOpportunity("0.05", "100", "0.1")?.annual, "0.06");
  assert.equal(calculateOpportunity("34.56789123", "33.33333333", "0.3")?.monthly, "3.46");
  assert.equal(calculateOpportunity("34.56789123", "33.33333333", "0.3")?.annual, "41.48");
});
test("zero and maximum supported inputs are valid", () => {
  for (const inputs of [["0", "50", "0.3"], ["500", "0", "0.3"], ["500", "50", "0"]]) {
    const result = calculateOpportunity(inputs[0]!, inputs[1]!, inputs[2]!);
    assert.equal(result?.monthly, "0.00"); assert.equal(result?.zero, true);
  }
  assert.equal(calculateOpportunity("1000000", "100", "1")?.annual, "12,000,000.00");
});
test("invalid fees, percentages and unsupported precision produce no estimate", () => {
  for (const value of ["", " ", "-1", "Infinity", "NaN", "1000000.00000001", "0.000000001", "1e3", "1,000", "<script>"]) assert.equal(calculateOpportunity(value, "50", "0.3"), null);
  for (const value of ["", "-1", "100.00000001", "Infinity"]) assert.equal(calculateOpportunity("500", value, "0.3"), null);
  for (const value of ["", "-0.1", "1.01", "NaN"]) assert.equal(calculateOpportunity("500", "50", value), null);
});
test("share percent is exact for rates that float multiplication distorts", () => {
  for (const [rate, percent] of [["0.07", "7"], ["0.57", "57"], ["0.29", "29"], ["0.145", "14.5"], ["0.3000000000", "30"], ["1", "100"], ["0", "0"]]) assert.equal(sharePercent(rate!), percent);
  for (const value of ["", "-0.1", "1.01", "NaN", "0.123456789"]) assert.equal(sharePercent(value), null);
  assert.equal(calculateOpportunity("100", "100", "0.57")?.monthly, "57.00");
});

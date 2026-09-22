import assert from "node:assert/strict";
import test from "node:test";
import { retainedChoiceId } from "../src/lib/retained-choice.ts";

test("an id outside the loaded page stays selected", () => {
  assert.equal(retainedChoiceId("offer-51", ["offer-1", "offer-2"]), "offer-51");
  assert.equal(retainedChoiceId("ex-9", []), "ex-9");
});

test("an id already loaded, or no current id, adds no extra option", () => {
  assert.equal(retainedChoiceId("offer-1", ["offer-1", "offer-2"]), "");
  assert.equal(retainedChoiceId(null, ["offer-1"]), "");
  assert.equal(retainedChoiceId("", ["offer-1"]), "");
});

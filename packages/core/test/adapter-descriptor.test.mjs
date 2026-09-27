import test from "node:test";
import assert from "node:assert/strict";
import { FileSourceAdapter, listFileAdapterDescriptors, registerAdapter, resolveRegisteredFileAdapter } from "../dist/index.js";

test("every registered file adapter has a descriptor and API adapters stay off the upload list", () => {
  const descriptors = listFileAdapterDescriptors();
  assert.deepEqual(descriptors.map((item) => item.id).sort(), ["bybit-normalized-csv", "mexc-referral-xlsx"]);
  const bybit = descriptors.find((item) => item.id === "bybit-normalized-csv");
  const mexc = descriptors.find((item) => item.id === "mexc-referral-xlsx");
  assert.equal(bybit.affectsCashback, true);
  assert.deepEqual(bybit.accept, [".csv"]);
  assert.equal(mexc.affectsCashback, false);
  assert.deepEqual(mexc.fields, ["rootAccount", "sourceTz", "period", "sourceAsOf"]);
  assert.equal(descriptors.some((item) => item.id === "bybit-affiliate-api"), false);
});

test("a JSON file adapter can register, validate an upload and parse without changing the route", async () => {
  class JsonActivityAdapter extends FileSourceAdapter {
    id = "bingx-json";
    exchangeSlug = "bingx";
    datasetKind = "REFERRAL_ACTIVITY";
    sourceMethod = "NATIVE_FILE";
    format = "json";
    accept = [".json"];
    uploadFields = ["rootAccount", "period"];
    affectsCashback = false;
    contract = { version: "bingx-json@1", fields: [{ target: "uid", source: "uid", type: "uidText", required: true }], ignored: [] };
    assertUpload(file) { if (file.extension !== "json" || !file.bytes.length) throw new Error("Invalid JSON upload"); }
    async parse(bytes) { return { kind: "REFERRAL_ACTIVITY", activity: { rows: JSON.parse(new TextDecoder().decode(bytes)), warnings: [], partial: false } }; }
  }
  registerAdapter(new JsonActivityAdapter());
  assert.equal(listFileAdapterDescriptors().some((item) => item.id === "bingx-json"), true);
  const chosen = resolveRegisteredFileAdapter({ exchangeSlug: "bingx", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", extension: "json" });
  assert.equal(chosen?.adapter.id, "bingx-json");
  const file = { extension: "json", bytes: new TextEncoder().encode('[{"uid":"123"}]') };
  chosen.adapter.assertUpload(file, {});
  assert.equal((await chosen.adapter.parse(file.bytes, {})).activity.rows[0].uid, "123");
  assert.equal(resolveRegisteredFileAdapter({ exchangeSlug: "mexc", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", extension: "xlsx" })?.mismatch, false);
  assert.equal(resolveRegisteredFileAdapter({ exchangeSlug: "mexc", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NORMALIZED_FILE", extension: "xlsx" })?.mismatch, true);
  assert.equal(resolveRegisteredFileAdapter({ exchangeSlug: "mexc", datasetKind: "COMMISSION", sourceMethod: "NATIVE_FILE", extension: "xlsx" }), null);
});

test("upload selects the newest adapter contract while replay can pin the old version", () => {
  class JsonV2 extends FileSourceAdapter {
    id = "bingx-json"; exchangeSlug = "bingx"; datasetKind = "REFERRAL_ACTIVITY";
    sourceMethod = "NATIVE_FILE"; format = "json"; accept = [".json"];
    uploadFields = ["rootAccount", "period"]; affectsCashback = false;
    contract = { version: "bingx-json@2", fields: [{ target: "uid", source: "uid", type: "uidText", required: true }], ignored: [] };
    assertUpload() {}
    async parse() { return { kind: "REFERRAL_ACTIVITY", activity: { rows: [], warnings: [], partial: false } }; }
  }
  registerAdapter(new JsonV2());
  assert.equal(resolveRegisteredFileAdapter({ exchangeSlug: "bingx", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", extension: "json" })?.adapter.contract.version, "bingx-json@2");
  assert.equal(resolveRegisteredFileAdapter({ exchangeSlug: "bingx", datasetKind: "REFERRAL_ACTIVITY", sourceMethod: "NATIVE_FILE", extension: "json", adapterId: "bingx-json", contractVersion: "bingx-json@1" })?.adapter.contract.version, "bingx-json@1");
  assert.deepEqual(listFileAdapterDescriptors().filter((item) => item.id === "bingx-json").map((item) => item.contractVersion), ["bingx-json@2"]);
});

test("registry rejects mismatched accept and format", () => {
  class BadAdapter extends FileSourceAdapter {
    id = "bad-json"; exchangeSlug = "bad"; datasetKind = "REFERRAL_ACTIVITY";
    sourceMethod = "NATIVE_FILE"; format = "json"; accept = [".csv"];
    uploadFields = []; affectsCashback = false;
    contract = { version: "bad-json@1", fields: [{ target: "uid", source: "uid", type: "uidText", required: true }], ignored: [] };
    assertUpload() {}
    async parse() { return { kind: "REFERRAL_ACTIVITY", activity: { rows: [], warnings: [], partial: false } }; }
  }
  assert.throws(() => registerAdapter(new BadAdapter()), /accept must match/);
});

import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// These are DOM state tests, not a browser, layout engine or screenshot test.
process.env.NODE_ENV = "test";
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost:3000/" });
const { window } = dom;
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Event", "KeyboardEvent", "MouseEvent", "FormData"]) {
  Object.defineProperty(globalThis, name, { value: name === "window" ? window : window[name], configurable: true, writable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.__auroraTestPath = "/";
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const cache = path.join(appRoot, ".next", "component-tests");
await mkdir(cache, { recursive: true });
const bundlePath = path.join(cache, `aurora-${process.pid}.mjs`);
const bundled = await build({
  stdin: { contents: 'export { OpportunityCheck } from "./src/components/public/opportunity-check"; export { CashbackLookup } from "./src/components/cashback-lookup"; export { PublicShell } from "./src/components/public/public-shell";', resolveDir: appRoot, loader: "tsx" },
  tsconfig: path.join(appRoot, "tsconfig.json"), bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
  external: ["react", "react/*", "react-dom", "react-dom/*", "@cashback/contracts", "lucide-react"],
  plugins: [{ name: "next-route-test-boundary", setup(builder) {
    builder.onResolve({ filter: /^next\/(link|navigation)$/ }, args => ({ path: args.path, namespace: "route-test" }));
    builder.onLoad({ filter: /.*/, namespace: "route-test" }, args => ({ contents: args.path === "next/link"
      ? 'import { createElement } from "react"; export default function Link({ children, href, ...props }) { return createElement("a", { ...props, href }, children); }'
      : 'export function usePathname() { return globalThis.__auroraTestPath; }', loader: "js" }));
  } }]
});
await writeFile(bundlePath, bundled.outputFiles[0].contents);
const { OpportunityCheck, CashbackLookup, PublicShell } = await import(pathToFileURL(bundlePath).href);
const originalFetch = globalThis.fetch;
const roots = new Set();
after(async () => { for (const root of roots) await act(async () => root.unmount()); globalThis.fetch = originalFetch; window.close(); await unlink(bundlePath); });

async function render(Component, props) {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); roots.add(root);
  const update = async next => { await act(async () => root.render(createElement(Component, next))); };
  await update(props);
  return { container, update, q(selector) { const element = container.querySelector(selector); assert.ok(element, `Missing ${selector}`); return element; }, async dispose() { await act(async () => root.unmount()); roots.delete(root); container.remove(); } };
}
async function change(element, value) {
  await act(async () => {
    const prototype = element.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(element, value);
    element.dispatchEvent(new window.Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function submit(view) { await act(async () => view.q("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }))); }
const offers = [
  { id: "bybit-30", exchangeId: "bybit", exchangeName: "Bybit", slug: "bybit", rate: "0.3" },
  { id: "binance-40", exchangeId: "binance", exchangeName: "Binance", slug: "binance", rate: "0.4" },
  { id: "mexc-35", exchangeId: "mexc", exchangeName: "MEXC", slug: "mexc", rate: "0.35" }
];
const exchanges = offers.map(offer => ({ id: offer.exchangeId, name: offer.exchangeName }));
const emptyResult = { hasData: false, hasMore: false, balances: [], transactions: [], lastImportAt: null, sourceAsOf: null };
const dataResult = { ...emptyResult, hasData: true, balances: [{ asset: "USDT", available: "248.5000000000", pending: "42.8000000000" }, { asset: "BTC", available: "0.0020000000", pending: "0.0010000000" }] };
const response = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("calculator switches all three exchanges and never sends inputs to a server", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; throw new Error("Unexpected network request"); };
  const view = await render(OpportunityCheck, { offers, locale: "en" });
  try {
    assert.equal(view.q("#opportunity-monthly").textContent, "75.00");
    for (const [id, amount] of [["binance", "100.00"], ["mexc", "87.50"], ["bybit", "75.00"]]) {
      await change(view.q("#opportunity-exchange"), id); assert.equal(view.q("#opportunity-monthly").textContent, amount);
      assert.equal(view.q(".aurora-opportunity-link").getAttribute("href"), `/exchanges/${id}`);
    }
    await act(async () => view.q('[aria-label="Example monthly trading fees"] button:last-child').click());
    assert.equal(view.q("#opportunity-monthly").textContent, "150.00"); assert.equal(calls, 0);
  } finally { await view.dispose(); globalThis.fetch = originalFetch; }
});
test("calculator invalid inputs clear results and zero recovers normally", async () => {
  const view = await render(OpportunityCheck, { offers, locale: "en" });
  try {
    for (const value of ["", "-1", "1000001"]) { await change(view.q("#monthly-fees"), value); assert.equal(view.q("#opportunity-monthly").textContent, "—"); assert.equal(view.q("#opportunity-error").hidden, false); }
    await change(view.q("#monthly-fees"), "500"); await change(view.q("#commission-percent"), "101"); await submit(view);
    assert.equal(view.q("details").open, true); assert.equal(view.q("#opportunity-monthly").textContent, "—");
    await change(view.q("#commission-percent"), "50"); await change(view.q("#monthly-fees"), "0");
    assert.equal(view.q("#opportunity-monthly").textContent, "0.00"); assert.equal(view.q("#opportunity-error").hidden, true);
  } finally { await view.dispose(); }
});
test("calculator selects a specific offer and survives refreshed published props", async () => {
  const multiple = [...offers, { ...offers[0], id: "bybit-07", rate: "0.07" }];
  const view = await render(OpportunityCheck, { offers: multiple, locale: "en" });
  try {
    await change(view.q("#opportunity-offer"), "bybit-07"); assert.equal(view.q("#opportunity-monthly").textContent, "17.50");
    assert.match(view.q(".aurora-opportunity-rate").textContent, /7%/);
    await view.update({ offers: offers.filter(offer => offer.slug !== "bybit"), locale: "en" });
    assert.equal(view.q("#opportunity-exchange").value, "binance"); assert.equal(view.q("#opportunity-monthly").textContent, "100.00");
  } finally { await view.dispose(); }
});
test("calculator has no fake fallback and becomes usable when offers arrive", async () => {
  const view = await render(OpportunityCheck, { offers: [{ ...offers[0], rate: "NaN" }], locale: "en" });
  try {
    assert.equal(view.q("#monthly-fees").disabled, true); assert.equal(view.q("#opportunity-monthly").textContent, "—");
    await view.update({ offers, locale: "en" }); assert.equal(view.q("#monthly-fees").disabled, false); assert.equal(view.q("#opportunity-monthly").textContent, "75.00");
  } finally { await view.dispose(); }
});
test("calculator output and descriptions reference existing controls", async () => {
  const view = await render(OpportunityCheck, { offers, locale: "en" });
  try { for (const attribute of ["for", "aria-describedby"]) for (const element of view.container.querySelectorAll(`[${attribute}]`)) for (const id of element.getAttribute(attribute).split(/\s+/)) assert.ok(view.container.querySelector(`[id="${id}"]`), `Missing ID reference ${id}`); } finally { await view.dispose(); }
});
test("lookup loading, leading-zero UID, multi-asset result and Wallet context", async () => {
  const pending = deferred(); let request;
  globalThis.fetch = async (...args) => { request = args; return pending.promise; };
  const view = await render(CashbackLookup, { exchanges, locale: "en" });
  try {
    await change(view.q('[name="uid"]'), " 001234 "); await submit(view);
    assert.equal(view.q('button[type], form button').disabled, true); assert.match(view.q("form button").textContent, /Checking/);
    assert.deepEqual(JSON.parse(request[1].body), { exchangeId: "bybit", uid: "001234" });
    await act(async () => pending.resolve(response(dataResult)));
    assert.match(view.q(".aurora-lookup-results").textContent, /248\.5/); assert.match(view.q(".aurora-lookup-results").textContent, /BTC/);
    assert.equal(view.q('.aurora-lookup-results a').getAttribute("href"), "/withdraw?exchangeId=bybit&uid=001234");
    await change(view.q('[name="exchangeId"]'), "mexc"); assert.equal(view.container.querySelector(".aurora-lookup-results"), null);
  } finally { await view.dispose(); globalThis.fetch = originalFetch; }
});
test("lookup no-data, validation and 429 do not reuse a prior balance", async () => {
  let calls = 0; globalThis.fetch = async () => { calls++; return calls === 1 ? response(emptyResult) : response({}, { status: 429, headers: { "Retry-After": "17" } }); };
  const view = await render(CashbackLookup, { exchanges, locale: "en" });
  try {
    await change(view.q('[name="uid"]'), " "); await submit(view); assert.equal(calls, 0);
    await change(view.q('[name="uid"]'), "001234"); await submit(view); assert.match(view.q(".aurora-lookup-results").textContent, /No cashback data/);
    await submit(view); assert.match(view.q('[role="alert"]').textContent, /17 seconds/); assert.equal(view.container.querySelector(".aurora-lookup-results"), null);
  } finally { await view.dispose(); globalThis.fetch = originalFetch; }
});
test("lookup handles server, network and malformed responses with plain English", async () => {
  const view = await render(CashbackLookup, { exchanges, locale: "en" });
  try {
    await change(view.q('[name="uid"]'), "001234");
    for (const fake of [async () => response({}, { status: 503 }), async () => { throw new TypeError("socket internals"); }, async () => response({ invalid: true }), async () => new Response("not JSON")]) {
      globalThis.fetch = fake; await submit(view); assert.equal(view.q('[role="alert"]').textContent, "Cashback is temporarily unavailable. Please try again."); assert.equal(view.q("form button").disabled, false);
    }
  } finally { await view.dispose(); globalThis.fetch = originalFetch; }
});
test("late lookup responses cannot repopulate data after a selection change", async () => {
  const pending = deferred(); let signal; globalThis.fetch = async (_url, options) => { signal = options.signal; return pending.promise; };
  const view = await render(CashbackLookup, { exchanges, locale: "en" });
  try {
    await change(view.q('[name="uid"]'), "001234"); await submit(view);
    await change(view.q('[name="uid"]'), "001235"); assert.equal(signal.aborted, true);
    await act(async () => pending.resolve(response(dataResult))); assert.equal(view.container.querySelector(".aurora-lookup-results"), null);
  } finally { await view.dispose(); globalThis.fetch = originalFetch; }
});
test("lookup aborts on unmount and has a disabled empty-catalog state", async () => {
  let signal; globalThis.fetch = async (_url, options) => { signal = options.signal; return new Promise(() => {}); };
  const view = await render(CashbackLookup, { exchanges, locale: "en" });
  await change(view.q('[name="uid"]'), "001234"); await submit(view); await view.dispose(); assert.equal(signal.aborted, true);
  globalThis.fetch = originalFetch;
  const empty = await render(CashbackLookup, { exchanges: [], locale: "en" });
  try { assert.equal(empty.q("form button").disabled, true); assert.equal(empty.q('[name="uid"]').disabled, true); } finally { await empty.dispose(); }
});
test("mobile menu supports Escape/focus and does not apply Aurora to admin", async () => {
  const props = { locale: "en", legacyHeader: createElement("header", null, "Legacy admin"), legacyFooter: null, children: createElement("main", { id: "main-content" }, "Content") };
  const view = await render(PublicShell, props);
  try {
    const toggle = view.q(".aurora-menu-toggle"); await act(async () => toggle.click()); assert.equal(toggle.getAttribute("aria-expanded"), "true");
    const mobileLink = view.q("#public-mobile-nav a"); mobileLink.focus();
    await act(async () => mobileLink.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(view.q("#public-mobile-nav").hidden, true); assert.equal(document.activeElement, toggle);
    globalThis.__auroraTestPath = "/admin/login"; await view.update(props);
    assert.equal(view.container.querySelector(".public-aurora"), null); assert.match(view.container.textContent, /Legacy admin/);
  } finally { globalThis.__auroraTestPath = "/"; await view.dispose(); }
});

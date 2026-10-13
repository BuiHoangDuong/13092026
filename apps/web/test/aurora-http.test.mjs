import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

const base = process.env.AURORA_SMOKE_URL;
test("Dark Aurora Docker HTTP integration", { skip: !base }, async t => {
  assert.ok(["localhost", "127.0.0.1", "web"].includes(new URL(base).hostname), "Smoke URL must be local Docker");
  assert.equal(new URL(process.env.DATABASE_URL).hostname, "postgres", "Fixtures must use the Docker database");
  const { db } = await import("@cashback/db");
  const { lookupResponseSchema } = await import("@cashback/contracts");
  const ip = `2001:db8:${randomUUID().replace(/-/g, "").slice(0, 24).match(/.{4}/g).join(":")}`;
  const headers = { "Content-Type": "application/json", "x-forwarded-for": ip };
  const get = path => fetch(new URL(path, base), { redirect: "manual" });
  const lookup = input => fetch(new URL("/api/lookup", base), { method: "POST", headers, body: JSON.stringify(input) });
  const markup = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let fixture;
  try {
    const catalogResponse = await get("/api/exchanges");
    assert.equal(catalogResponse.status, 200);
    const { exchanges } = await catalogResponse.json();
    assert.deepEqual(exchanges.map(exchange => exchange.slug).sort(), ["binance", "bybit", "mexc"]);
    const bybit = exchanges.find(exchange => exchange.slug === "bybit");
    await t.test("home SSR retains hero, calculator order and three published cards", async () => {
      const response = await get("/"); assert.equal(response.status, 200);
      const html = markup(await response.text());
      assert.match(html, /class="public-aurora"/); assert.match(html, /Same trades\./);
      assert.match(html, /248\.50/); assert.match(html, /Illustrative balance/);
      assert.ok(html.indexOf('class="aurora-stage"') < html.indexOf('id="opportunity"'));
      assert.ok(html.indexOf('id="opportunity"') < html.indexOf('id="lookup"'));
      assert.equal((html.match(/class="aurora-offer-card"/g) ?? []).length, 3);
      assert.match(html, /id="opportunity-monthly"[^>]*>75\.00<\/output>/);
      assert.match(html, /900\.00/); assert.match(html, /href="\/withdraw"/);
      assert.match(html, /Illustrative example/); assert.doesNotMatch(html, /6,000|Pages coming soon|\/me\/wallet/);
    });
    await t.test("public pages, logo assets and referral routes serve without external fetches", async () => {
      for (const path of ["/api/health", "/exchanges", "/guides", "/withdraw", ...exchanges.map(exchange => `/exchanges/${exchange.slug}`)]) assert.equal((await get(path)).status, 200, path);
      for (const exchange of exchanges) {
        const logo = await get(exchange.logoUrl); assert.equal(logo.status, 200); assert.match(logo.headers.get("content-type"), /image\/png/);
        if (exchange.links[0]) { const link = await get(`/go/${exchange.links[0].id}`); assert.ok([302, 307, 308].includes(link.status)); assert.ok(link.headers.get("location")); }
      }
    });
    await t.test("admin retains its shell and unauthenticated routes stay protected", async () => {
      const response = await get("/admin"); assert.ok([302, 307].includes(response.status));
      assert.equal(new URL(response.headers.get("location"), base).pathname, "/admin/login");
      const login = markup(await (await get("/admin/login")).text());
      assert.doesNotMatch(login, /class="public-aurora"/); assert.match(login, /Admin/);
      assert.equal((await get("/api/uid/wallet")).status, 401);
    });
    await t.test("lookup has an explicit no-data state and rejects blank UID", async () => {
      const empty = await lookup({ exchangeId: bybit.id, uid: `001234-missing-${randomUUID()}` }); assert.equal(empty.status, 200);
      assert.match(empty.headers.get("cache-control"), /no-store/);
      const result = lookupResponseSchema.parse(await empty.json()); assert.equal(result.hasData, false); assert.deepEqual(result.balances, []);
      assert.equal((await lookup({ exchangeId: bybit.id, uid: " " })).status, 400);
    });
    await t.test("synthetic UID retains leading zeros and separate asset balances", async () => {
      const uid = `001234-ui-${randomUUID()}`;
      fixture = await db.uidAccount.create({ data: { exchangeId: bybit.id, uid, wallets: { create: [{ asset: "USDT", pending: "42.8", available: "248.5" }, { asset: "BTC", pending: "0.001", available: "0.002" }] } } });
      await db.commissionRecord.create({ data: { exchangeId: bybit.id, uid, asset: "USDT", dedupKey: `aurora-smoke:${fixture.id}`, periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-10-02T00:00:00Z"), attributedUidAccountId: fixture.id, cashbackRate: "0.3", creditedCashback: "75" } });
      const response = await lookup({ exchangeId: bybit.id, uid }); assert.equal(response.status, 200);
      const result = lookupResponseSchema.parse(await response.json()); assert.equal(result.hasData, true);
      assert.deepEqual(result.balances.map(balance => balance.asset), ["BTC", "USDT"]);
      assert.equal(result.balances[1].available, "248.5000000000"); assert.equal(result.balances[0].available, "0.0020000000");
      assert.equal(result.transactions[0].cashback, "75.0000000000"); assert.equal(result.transactions[0].commission, "0.0000000000");
      const page = markup(await (await get(`/withdraw?exchangeId=${bybit.id}&uid=${encodeURIComponent(uid)}`)).text());
      assert.ok(page.includes(uid)); assert.match(page, /Send verification code/);
    });
    await t.test("rate-limited lookup returns Retry-After", async () => {
      const limit = Number(process.env.LOOKUP_RATE_PER_MINUTE || 5);
      assert.ok(limit <= 30, "Do not run an unbounded rate-limit probe");
      let response;
      for (let index = 0; index <= limit; index++) {
        response = await lookup({ exchangeId: bybit.id, uid: "001234-rate-probe" });
        if (response.status === 429) break;
      }
      assert.equal(response.status, 429); assert.ok(Number(response.headers.get("retry-after")) > 0);
    });
  } finally {
    if (fixture) await db.$transaction([db.commissionRecord.deleteMany({ where: { attributedUidAccountId: fixture.id } }), db.wallet.deleteMany({ where: { uidAccountId: fixture.id } }), db.uidAccount.delete({ where: { id: fixture.id } })]);
    await db.$disconnect();
  }
});

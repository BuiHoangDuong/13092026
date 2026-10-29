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
  const lookup = (input, clientIp = `2001:db8:${randomUUID().replace(/-/g, "").slice(0, 24).match(/.{4}/g).join(":")}`) => fetch(new URL("/api/lookup", base), { method: "POST", headers: { ...headers, "x-forwarded-for": clientIp }, body: JSON.stringify(input) });
  const markup = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  let fixture, coverage;
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
      assert.match(html, /id="monthly-volume"/); assert.doesNotMatch(html, /id="trading-fee-percent"|id="commission-percent"/);
      assert.match(html, /id="opportunity-monthly"[^>]*>[0-9,.]+<\/output>/);
      assert.doesNotMatch(html, /href="\/withdraw|Verify email and withdraw|Email verification is required/);
      assert.match(html, /Illustrative example/); assert.doesNotMatch(html, /6,000|Pages coming soon|\/me\/wallet/);
    });
    await t.test("public pages, logo assets and referral routes serve without external fetches", async () => {
      for (const path of ["/api/health", "/exchanges", "/guides", ...exchanges.map(exchange => `/exchanges/${exchange.slug}`)]) assert.equal((await get(path)).status, 200, path);
      const retired = await get("/withdraw"); assert.equal(retired.status, 307); assert.equal(retired.headers.get("location"), "/#lookup");
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
      fixture = await db.uidAccount.create({ data: { exchangeId: bybit.id, uid, wallets: { create: [{ asset: "USDT", pending: "42.8", available: "248.5", withdrawn: "90" }, { asset: "BTC", pending: "0.001", available: "0.002", withdrawn: "0.003" }] } } });
      const now = new Date(); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const start = new Date(end.getTime() - 86400000);
      coverage = await db.importBatch.create({ data: { exchangeId: bybit.id, rootAccount: `aurora-${fixture.id}`, datasetKind: "COMMISSION", sourceMethod: "NORMALIZED_FILE", reportType: "TRANSACTION", periodStart: start, periodEnd: new Date(end.getTime() - 1), sourceTz: "UTC", fileRef: "synthetic-coverage", status: "PUBLISHED" } });
      const record = { exchangeId: bybit.id, uid, asset: "USDT", periodStart: start, periodEnd: new Date(end.getTime() - 1), attributedUidAccountId: fixture.id, cashbackRate: "0.3" };
      await db.commissionRecord.createMany({ data: [
        { ...record, dedupKey: `aurora-smoke:${fixture.id}`, creditedCashback: "75" },
        ...Array.from({ length: 130 }, (_, i) => ({ ...record, dedupKey: `aurora-smoke:${fixture.id}:${i}`, creditedCashback: "1" })),
        { ...record, periodStart: end, periodEnd: new Date(end.getTime() + 86400000 - 1), dedupKey: `aurora-smoke:${fixture.id}:today`, creditedCashback: "999" },
        { ...record, asset: "BTC", dedupKey: `aurora-smoke:${fixture.id}:zero`, creditedCashback: "0" }
      ] });
      const response = await lookup({ exchangeId: bybit.id, uid }); assert.equal(response.status, 200);
      const result = lookupResponseSchema.parse(await response.json()); assert.equal(result.hasData, true);
      assert.equal(result.summaryPeriods.reportDay, start.toISOString().slice(0, 10));
      assert.deepEqual(result.balances.map(balance => balance.asset), ["BTC", "USDT"]);
      assert.equal(result.balances[1].totalPaid, "90.0000000000"); assert.equal(result.balances[0].totalPaid, "0.0030000000");
      assert.equal(result.balances[1].previousDay.amount, "205.0000000000"); assert.equal(result.balances[1].rolling30Days.amount, "205.0000000000");
      assert.equal(result.balances[0].previousDay.status, "REPORTED"); assert.equal(result.balances[0].previousDay.amount, "0.0000000000");
      assert.equal(result.transactions.length, 100); assert.equal(result.hasMore, true);
      assert.ok(result.transactions.every(row => row.uid === uid));
      assert.doesNotMatch(JSON.stringify(result), /commission|cashbackRate|volume|pending|available|withdrawn|reserved|receivable|email|address/);
      const boundary = await db.commissionRecord.create({ data: { ...record, dedupKey: `aurora-smoke:${fixture.id}:boundary`, periodStart: new Date(end.getTime() - 31 * 86400000), periodEnd: new Date(end.getTime() - 29 * 86400000), creditedCashback: "300" } });
      const partial = lookupResponseSchema.parse(await (await lookup({ exchangeId: bybit.id, uid })).json());
      assert.equal(partial.balances[1].rolling30Days.status, "INSUFFICIENT_DETAIL"); assert.equal(partial.balances[1].rolling30Days.amount, null);
      await db.commissionRecord.delete({ where: { id: boundary.id } });
      assert.equal((await get(`/withdraw?exchangeId=${bybit.id}&uid=${encodeURIComponent(uid)}`)).status, 307);
    });
    await t.test("retired customer money writes do not create rows or change balances", async () => {
      const before = { withdrawals: await db.withdrawal.count(), jobs: await db.job.count(), wallets: await db.wallet.findMany({ where: { uidAccountId: fixture.id } }) };
      for (const path of ["/api/uid/withdrawals", "/api/uid/withdrawals/nonexistent/cancel"]) {
        for (const cookie of ["", "cashback_uid_session=invalid"]) {
          const response = await fetch(new URL(path, base), { method: "POST", headers: { ...headers, Cookie: cookie }, body: "malformed JSON" });
          assert.equal(response.status, 410); assert.equal((await response.json()).error.code, "CUSTOMER_WITHDRAWALS_RETIRED");
        }
      }
      assert.equal(await db.withdrawal.count(), before.withdrawals); assert.equal(await db.job.count(), before.jobs);
      assert.deepEqual(await db.wallet.findMany({ where: { uidAccountId: fixture.id } }), before.wallets);
    });
    await t.test("rate-limited lookup returns Retry-After", async () => {
      const limit = Number(process.env.LOOKUP_RATE_PER_MINUTE || 5);
      assert.ok(limit <= 30, "Do not run an unbounded rate-limit probe");
      let response;
      for (let index = 0; index <= limit; index++) {
        response = await lookup({ exchangeId: bybit.id, uid: "001234-rate-probe" }, ip);
        if (response.status === 429) break;
      }
      assert.equal(response.status, 429); assert.ok(Number(response.headers.get("retry-after")) > 0);
    });
  } finally {
    if (coverage) await db.importBatch.delete({ where: { id: coverage.id } });
    if (fixture) await db.$transaction([db.commissionRecord.deleteMany({ where: { attributedUidAccountId: fixture.id } }), db.wallet.deleteMany({ where: { uidAccountId: fixture.id } }), db.uidAccount.delete({ where: { id: fixture.id } })]);
    await db.$disconnect();
  }
});

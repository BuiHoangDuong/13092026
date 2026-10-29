import test from "node:test";
import assert from "node:assert/strict";
import { db, Prisma } from "@cashback/db";
import { estimatedVolumeRateSchema } from "@cashback/contracts";
import { getPublishedExchange, getExchangeOfferCards, listPublishedExchanges, listPublishedOfferCards, listAdminOffers } from "../dist/index.js";

test("offer estimates serialize as plain decimals across public and admin content", async t => {
  const original = { list: db.exchange.findMany, detail: db.exchange.findFirst, offers: db.offer.findMany };
  t.after(() => { db.exchange.findMany = original.list; db.exchange.findFirst = original.detail; db.offer.findMany = original.offers; });
  const expected = ["0.00000005", "0.0000000001", "0", "1", null];
  const offers = expected.map((rate, i) => ({ id: `offer-${i}`, exchangeId: "exchange", status: "PUBLISHED", cashbackRate: new Prisma.Decimal("0.3"), estimatedVolumeRate: rate === null ? null : new Prisma.Decimal(rate), conditions: {}, verifiedAt: null }));
  const exchange = { id: "exchange", slug: "bybit", name: "Bybit", logoUrl: null, defaultCashbackRate: null, i18n: {}, offers, links: [] };
  db.exchange.findMany = async () => [exchange]; db.exchange.findFirst = async () => exchange; db.offer.findMany = async () => offers;
  assert.equal(offers[0].estimatedVolumeRate.toString(), "5e-8");
  const results = [(await listPublishedExchanges())[0].offers, (await getPublishedExchange("bybit")).offers, await listPublishedOfferCards(), await getExchangeOfferCards("bybit"), (await listAdminOffers()).items];
  for (const rows of results) {
    assert.deepEqual(rows.map(offer => offer.estimatedVolumeRate), expected);
    for (const offer of rows) if (offer.estimatedVolumeRate !== null) assert.equal(estimatedVolumeRateSchema.safeParse(offer.estimatedVolumeRate).success, true);
  }
});

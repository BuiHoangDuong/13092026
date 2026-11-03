import test from "node:test";
import assert from "node:assert/strict";
import { db, Prisma } from "@cashback/db";
import { getPublishedExchange, getExchangeOfferCards, listPublishedExchanges, listPublishedOfferCards, listAdminExchanges } from "../dist/index.js";

test("public and admin content preserve offer shares without a per-exchange fee", async t => {
  const original = { list: db.exchange.findMany, detail: db.exchange.findFirst };
  t.after(() => { db.exchange.findMany = original.list; db.exchange.findFirst = original.detail; });
  for (const rate of ["0.3", "0.1234", "0", "1"]) {
    const offers = [{ id: "offer", cashbackRate: new Prisma.Decimal(rate), conditions: {}, verifiedAt: null }];
    const removedField = "commission" + "VolumeRate";
    const exchange = { id: "exchange", slug: "bybit", name: "Bybit", logoUrl: null, defaultCashbackRate: null, i18n: {}, offers, links: [] };
    db.exchange.findMany = async () => [exchange]; db.exchange.findFirst = async () => exchange;
    const cards = [...await listPublishedOfferCards(), ...await getExchangeOfferCards("bybit")];
    const results = [(await listPublishedExchanges())[0], await getPublishedExchange("bybit"), ...cards.map(card => card.exchange), (await listAdminExchanges()).items[0]];
    for (const row of results) assert.equal(removedField in row, false);
    for (const card of cards) assert.equal(card.cashbackRate, rate);
  }
});

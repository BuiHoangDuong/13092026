import test from "node:test";
import assert from "node:assert/strict";
import { db, Prisma } from "@cashback/db";
import { commissionVolumeRateSchema } from "@cashback/contracts";
import { getPublishedExchange, getExchangeOfferCards, listPublishedExchanges, listPublishedOfferCards, listAdminExchanges } from "../dist/index.js";

test("exchange commission serializes as plain decimals across public and admin content", async t => {
  const original = { list: db.exchange.findMany, detail: db.exchange.findFirst };
  t.after(() => { db.exchange.findMany = original.list; db.exchange.findFirst = original.detail; });
  for (const rate of ["0.01", "0.00000005", "0.0000000001", "0", "1"]) {
    const offers = [{ id: "offer", cashbackRate: new Prisma.Decimal("0.3"), conditions: {}, verifiedAt: null }];
    const exchange = { id: "exchange", slug: "bybit", name: "Bybit", logoUrl: null, defaultCashbackRate: null, commissionVolumeRate: new Prisma.Decimal(rate), i18n: {}, offers, links: [] };
    db.exchange.findMany = async () => [exchange]; db.exchange.findFirst = async () => exchange;
    const results = [(await listPublishedExchanges())[0], await getPublishedExchange("bybit"), (await listPublishedOfferCards())[0].exchange, (await getExchangeOfferCards("bybit"))[0].exchange, (await listAdminExchanges()).items[0]];
    for (const row of results) { assert.equal(row.commissionVolumeRate, rate); assert.equal(commissionVolumeRateSchema.safeParse(row.commissionVolumeRate).success, true); }
  }
});

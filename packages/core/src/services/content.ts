import { db, PublishStatus } from "@cashback/db";
import type {
  AdminExchangeCreate, AdminExchangeUpdate, AdminGuideCreate, AdminGuideUpdate,
  AdminLinkCreate, AdminLinkUpdate, AdminOfferCreate, AdminOfferUpdate
} from "@cashback/contracts";

type Localized = Record<string, { name?: string; description?: string; title?: string; content?: string }>;

export type PublicOffer = { id: string; cashbackRate: string; conditions: unknown; verifiedAt: Date | null };
export type PublicLink = { id: string; destination: string; offerId: string | null };
export type PublicExchange = {
  id: string; slug: string; name: string; description: string; defaultCashbackRate: string | null;
  logoUrl: string | null;
  offers: PublicOffer[]; links: PublicLink[];
};
export type PublicOfferCard = {
  offerId: string;
  exchange: { id: string; slug: string; name: string; description: string; logoUrl: string | null };
  cashbackRate: string;
  conditions: unknown;
  linkId: string | null;
};
export type PublicGuide = { id: string; slug: string; title?: string; content?: string; exchange: { id: string; name: string } | null };

function localized(value: unknown, locale: string) {
  const messages = (value ?? {}) as Localized;
  return messages[locale] ?? messages.en ?? {};
}

export async function listPublishedExchanges(locale = "en"): Promise<PublicExchange[]> {
  const rows = await db.exchange.findMany({
    where: { status: PublishStatus.PUBLISHED },
    include: {
      offers: { where: { status: PublishStatus.PUBLISHED }, orderBy: { cashbackRate: "desc" } },
      links: { where: { active: true } }
    },
    orderBy: { name: "asc" }
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    logoUrl: row.logoUrl ?? null,
    name: localized(row.i18n, locale).name ?? row.name,
    description: localized(row.i18n, locale).description ?? "",
    defaultCashbackRate: row.defaultCashbackRate?.toString() ?? null,
    offers: row.offers.map((offer) => ({ id: offer.id, cashbackRate: offer.cashbackRate.toString(), conditions: offer.conditions, verifiedAt: offer.verifiedAt })),
    links: row.links.map((link) => ({ id: link.id, destination: link.destination, offerId: link.offerId }))
  }));
}

/**
 * Picks the referral link for an offer: the link explicitly bound to it, else an unbound
 * link, else the first active link on the exchange. Shared by every view that needs an
 * offer -> link pairing so the matching rule lives in one place.
 */
function pickLinkForOffer(offerId: string, links: PublicLink[]): PublicLink | null {
  return (
    links.find((candidate) => candidate.offerId === offerId) ??
    links.find((candidate) => candidate.offerId === null) ??
    links[0] ??
    null
  );
}

function toOfferCard(exchange: PublicExchange, offer: PublicOffer): PublicOfferCard {
  const link = pickLinkForOffer(offer.id, exchange.links);
  return {
    offerId: offer.id,
    exchange: { id: exchange.id, slug: exchange.slug, name: exchange.name, description: exchange.description, logoUrl: exchange.logoUrl },
    cashbackRate: offer.cashbackRate,
    conditions: offer.conditions,
    linkId: link?.id ?? null
  };
}

/**
 * Flattens published exchanges into one card per published offer (an exchange with two
 * live offers renders as two cards), matching each offer to the referral link bound to it
 * (falling back to an unbound or first active link) so the CTA always has somewhere to go.
 */
export async function listPublishedOfferCards(locale = "en"): Promise<PublicOfferCard[]> {
  const exchanges = await listPublishedExchanges(locale);
  const cards = exchanges.flatMap((exchange) => exchange.offers.map((offer) => toOfferCard(exchange, offer)));
  return cards.sort((a, b) => Number(b.cashbackRate) - Number(a.cashbackRate));
}

/** Offer cards for a single exchange's detail page, using the same offer<->link matching rule. */
export async function getExchangeOfferCards(slug: string, locale = "en"): Promise<PublicOfferCard[]> {
  const exchange = await getPublishedExchange(slug, locale);
  if (!exchange) return [];
  return exchange.offers.map((offer) => toOfferCard(exchange, offer)).sort((a, b) => Number(b.cashbackRate) - Number(a.cashbackRate));
}

export type PublicStats = { exchangeCount: number };

/** Counts that come straight from the database; keep this separate from marketing copy. */
export async function getPublicStats(): Promise<PublicStats> {
  const exchangeCount = await db.exchange.count({ where: { status: PublishStatus.PUBLISHED } });
  return { exchangeCount };
}

export async function getPublishedExchange(slug: string, locale = "en"): Promise<PublicExchange | null> {
  const exchange = await db.exchange.findFirst({
    where: { slug, status: PublishStatus.PUBLISHED },
    include: {
      offers: { where: { status: PublishStatus.PUBLISHED } },
      links: { where: { active: true } },
      guides: { where: { status: PublishStatus.PUBLISHED } }
    }
  });
  if (!exchange) return null;
  const text = localized(exchange.i18n, locale);
  return {
    id: exchange.id, slug: exchange.slug, name: text.name ?? exchange.name, description: text.description ?? "",
    logoUrl: exchange.logoUrl ?? null,
    defaultCashbackRate: exchange.defaultCashbackRate?.toString() ?? null,
    offers: exchange.offers.map((offer) => ({ id: offer.id, cashbackRate: offer.cashbackRate.toString(), conditions: offer.conditions, verifiedAt: offer.verifiedAt })),
    links: exchange.links.map((link) => ({ id: link.id, destination: link.destination, offerId: link.offerId }))
  };
}

export async function listPublishedGuides(locale = "en"): Promise<PublicGuide[]> {
  const guides = await db.guide.findMany({ where: { status: PublishStatus.PUBLISHED }, include: { exchange: true } });
  return guides.map((guide) => ({ id: guide.id, slug: guide.slug, ...localized(guide.i18n, locale), exchange: guide.exchange ? { id: guide.exchange.id, name: guide.exchange.name } : null }));
}

export async function getPublishedGuide(slug: string, locale = "en"): Promise<PublicGuide | null> {
  const guide = await db.guide.findFirst({ where: { slug, status: PublishStatus.PUBLISHED }, include: { exchange: true } });
  return guide ? { id: guide.id, slug: guide.slug, ...localized(guide.i18n, locale), exchange: guide.exchange ? { id: guide.exchange.id, name: guide.exchange.name } : null } : null;
}

export class ContentError extends Error {
  constructor(public readonly code: "CONTENT_NOT_FOUND" | "CONTENT_CONFLICT" | "OFFER_EXCHANGE_MISMATCH" | "INVALID_REFERENCE", message: string) {
    super(message);
  }
}

async function write<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    // Prisma may be bundled through more than one workspace path, so instanceof is not
    // reliable across package boundaries. Its stable error code is the portable contract.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    if (code === "P2025") {
      throw new ContentError("CONTENT_NOT_FOUND", "Content item not found");
    }
    if (code === "P2002") {
      throw new ContentError("CONTENT_CONFLICT", "A content item already uses this unique value");
    }
    if (code === "P2003") {
      throw new ContentError("INVALID_REFERENCE", "One or more referenced records (e.g. exchangeId, offerId) do not exist");
    }
    throw error;
  }
}

function status(value: "DRAFT" | "PUBLISHED") {
  return value === "PUBLISHED" ? PublishStatus.PUBLISHED : PublishStatus.DRAFT;
}

async function assertOfferExchange(offerId: string | null | undefined, exchangeId: string) {
  if (!offerId) return;
  const offer = await db.offer.findUnique({ where: { id: offerId }, select: { exchangeId: true } });
  if (!offer) throw new ContentError("CONTENT_NOT_FOUND", "Offer not found");
  if (offer.exchangeId !== exchangeId) throw new ContentError("OFFER_EXCHANGE_MISMATCH", "Offer and referral link must belong to the same exchange");
}

export type AdminContent = {
  exchanges: Array<{ id: string; slug: string; name: string; status: "DRAFT" | "PUBLISHED"; defaultCashbackRate: string | null; i18n: unknown }>;
  offers: Array<{ id: string; exchangeId: string; status: "DRAFT" | "PUBLISHED"; cashbackRate: string; conditions: unknown; verifiedAt: string | null }>;
  links: Array<{ id: string; exchangeId: string; offerId: string | null; destination: string; active: boolean }>;
  guides: Array<{ id: string; slug: string; exchangeId: string | null; status: "DRAFT" | "PUBLISHED"; i18n: unknown }>;
};

export type AdminListOptions = { cursor?: string; limit?: number };
export type AdminPage<T> = { items: T[]; nextCursor: string | null };

function pageLimit(value?: number) {
  return Math.max(1, Math.min(value ?? 50, 100));
}

function toPage<T extends { id: string }>(rows: T[], limit: number): AdminPage<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
}

export async function listAdminExchanges(options: AdminListOptions = {}): Promise<AdminPage<AdminContent["exchanges"][number]>> {
  const limit = pageLimit(options.limit);
  const rows = await db.exchange.findMany({
    select: { id: true, slug: true, name: true, status: true, defaultCashbackRate: true, i18n: true },
    orderBy: { id: "asc" }, take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  });
  return toPage(rows.map(({ defaultCashbackRate, ...row }) => ({ ...row, defaultCashbackRate: defaultCashbackRate?.toString() ?? null })), limit);
}

export async function listAdminOffers(options: AdminListOptions = {}): Promise<AdminPage<AdminContent["offers"][number]>> {
  const limit = pageLimit(options.limit);
  const rows = await db.offer.findMany({
    select: { id: true, exchangeId: true, status: true, cashbackRate: true, conditions: true, verifiedAt: true },
    orderBy: { id: "asc" }, take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  });
  return toPage(rows.map(({ cashbackRate, verifiedAt, ...row }) => ({ ...row, cashbackRate: cashbackRate.toString(), verifiedAt: verifiedAt?.toISOString() ?? null })), limit);
}

export async function listAdminLinks(options: AdminListOptions = {}): Promise<AdminPage<AdminContent["links"][number]>> {
  const limit = pageLimit(options.limit);
  const rows = await db.referralLink.findMany({
    select: { id: true, exchangeId: true, offerId: true, destination: true, active: true },
    orderBy: { id: "asc" }, take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  });
  return toPage(rows, limit);
}

export async function listAdminGuides(options: AdminListOptions = {}): Promise<AdminPage<AdminContent["guides"][number]>> {
  const limit = pageLimit(options.limit);
  const rows = await db.guide.findMany({
    select: { id: true, slug: true, exchangeId: true, status: true, i18n: true },
    orderBy: { id: "asc" }, take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {})
  });
  return toPage(rows, limit);
}

export async function listAdminContent(): Promise<AdminContent> {
  const [exchanges, offers, links, guides] = await Promise.all([listAdminExchanges(), listAdminOffers(), listAdminLinks(), listAdminGuides()]);
  return { exchanges: exchanges.items, offers: offers.items, links: links.items, guides: guides.items };
}

export function createExchange(input: AdminExchangeCreate): Promise<{ id: string }> {
  return write(() => db.exchange.create({ data: { ...input, status: status(input.status) }, select: { id: true } }));
}
export async function updateExchange(input: AdminExchangeUpdate): Promise<{ id: string }> {
  const { id, status: nextStatus, ...data } = input;
  return write(() => db.exchange.update({ where: { id }, data: { ...data, ...(nextStatus ? { status: status(nextStatus) } : {}) }, select: { id: true } }));
}

export function createOffer(input: AdminOfferCreate): Promise<{ id: string }> {
  return write(() => db.offer.create({ data: { ...input, status: status(input.status), verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : null, seedKey: undefined }, select: { id: true } }));
}
export async function updateOffer(input: AdminOfferUpdate): Promise<{ id: string }> {
  const { id, status: nextStatus, verifiedAt, ...data } = input;
  if (input.exchangeId) {
    const incompatibleLink = await db.referralLink.findFirst({ where: { offerId: id, exchangeId: { not: input.exchangeId } }, select: { id: true } });
    if (incompatibleLink) throw new ContentError("OFFER_EXCHANGE_MISMATCH", "Move or detach the offer's referral links before changing its exchange");
  }
  return write(() => db.offer.update({ where: { id }, data: { ...data, ...(nextStatus ? { status: status(nextStatus) } : {}), ...(verifiedAt !== undefined ? { verifiedAt: verifiedAt ? new Date(verifiedAt) : null } : {}) }, select: { id: true } }));
}

export async function createReferralLink(input: AdminLinkCreate): Promise<{ id: string }> {
  await assertOfferExchange(input.offerId, input.exchangeId);
  return write(() => db.referralLink.create({ data: { ...input, seedKey: undefined }, select: { id: true } }));
}
export async function updateReferralLink(input: AdminLinkUpdate): Promise<{ id: string }> {
  const current = await db.referralLink.findUnique({ where: { id: input.id } });
  if (!current) throw new ContentError("CONTENT_NOT_FOUND", "Referral link not found");
  const exchangeId = input.exchangeId ?? current.exchangeId;
  const offerId = input.offerId === undefined ? current.offerId : input.offerId;
  await assertOfferExchange(offerId, exchangeId);
  const { id, ...data } = input;
  return write(() => db.referralLink.update({ where: { id }, data, select: { id: true } }));
}

export function createGuide(input: AdminGuideCreate): Promise<{ id: string }> {
  return write(() => db.guide.create({ data: { ...input, status: status(input.status) }, select: { id: true } }));
}
export async function updateGuide(input: AdminGuideUpdate): Promise<{ id: string }> {
  const { id, status: nextStatus, ...data } = input;
  return write(() => db.guide.update({ where: { id }, data: { ...data, ...(nextStatus ? { status: status(nextStatus) } : {}) }, select: { id: true } }));
}

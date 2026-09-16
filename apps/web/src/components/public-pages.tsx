import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
  getExchangeOfferCards,
  getPublicStats,
  getPublishedExchange,
  getPublishedGuide,
  listPublishedGuides,
  listPublishedOfferCards,
  type PublicOfferCard
} from "@cashback/core";
import { getMessages, localePath, type Locale } from "../i18n";
import { marketingStatsPlaceholder } from "../content/marketing-stats";
import { generateLedgerDemoRows } from "../content/ledger-demo";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { CashbackLookup } from "./cashback-lookup";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";

function conditionsText(conditions: unknown, fallback: string): string {
  if (typeof conditions === "string") return conditions;
  if (conditions && typeof conditions === "object") {
    const record = conditions as Record<string, string>;
    return record.en ?? Object.values(record)[0] ?? fallback;
  }
  return fallback;
}

/** $100 affiliate commission -> $X cashback. This is not the customer's trading fee. */
function exampleBack(rate: string): number {
  return Math.round(100 * Number(rate) * 100) / 100;
}

/** Deterministic placeholder tile color per exchange, so tiles look distinct without real logos. */
const TILE_HUES = [45, 200, 265, 140, 320, 15] as const;
function tileHue(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return TILE_HUES[hash % TILE_HUES.length] ?? TILE_HUES[0];
}

/**
 * Marketplace-style square tile (reference: plati.market catalog grid): an exchange logo
 * (or colored placeholder) on top, exchange name below, cashback rate as a corner badge. Clicking the
 * tile opens the exchange detail page rather than the referral link directly, matching the
 * reference site's "browse first" flow.
 */
function OfferCard({ card, locale }: { card: PublicOfferCard; locale: Locale }) {
  const messages = getMessages(locale);
  const ratePercent = Number(card.cashbackRate) * 100;
  const hue = tileHue(card.exchange.slug);
  return (
    <Link href={localePath(locale, `/exchanges/${card.exchange.slug}`)} className="group flex flex-col">
      <div
        className="relative flex aspect-square items-center justify-center overflow-hidden rounded-xl border border-border bg-card transition-transform group-hover:scale-[1.02]"
        style={card.exchange.logoUrl ? undefined : { background: `linear-gradient(155deg, oklch(0.4 0.12 ${hue}), oklch(0.24 0.08 ${hue}))` }}
      >
        {card.exchange.logoUrl ? (
          <div className="absolute inset-x-5 top-1/2 h-[18%] -translate-y-1/2">
            <Image
              src={card.exchange.logoUrl}
              alt=""
              fill
              sizes="(min-width: 1152px) 130px, (min-width: 1024px) 12vw, (min-width: 768px) 19vw, (min-width: 640px) 26vw, 40vw"
              className="object-contain"
            />
          </div>
        ) : (
          <span className="px-3 text-center text-xl font-bold text-white/95">{card.exchange.name}</span>
        )}
        <Badge variant="success" className="absolute right-2 top-2 shadow-sm">
          {ratePercent}%
        </Badge>
      </div>
      <p className="mt-2 truncate text-sm font-medium text-foreground">{card.exchange.name}</p>
      <p className="truncate text-xs text-muted-foreground">
        {messages.exchanges.exampleTemplate.replace("{{amount}}", String(exampleBack(card.cashbackRate)))}
      </p>
    </Link>
  );
}

/** Full offer detail used on the exchange page and the top-3 home preview (not the tile grid). */
function OfferDetailCard({ card, locale }: { card: PublicOfferCard; locale: Locale }) {
  const messages = getMessages(locale);
  const ratePercent = Number(card.cashbackRate) * 100;
  return (
    <Card className="flex h-full flex-col justify-between transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle>{card.exchange.name}</CardTitle>
        <p className="text-sm text-muted-foreground">{card.exchange.description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Badge variant="success" className="text-sm">
          {messages.exchanges.cashbackLabel}: {ratePercent}%
        </Badge>
        <div className="rounded-lg bg-muted/50 px-4 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {messages.exchanges.exampleLabel}
          </p>
          <p className="mt-1 text-lg font-semibold text-foreground">
            {messages.exchanges.exampleTemplate.replace("{{amount}}", String(exampleBack(card.cashbackRate)))}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {conditionsText(card.conditions, messages.exchanges.conditionsFallback)}
        </p>
        {card.linkId && (
          <Button asChild variant="secondary" className="w-fit">
            <a href={`/go/${card.linkId}`}>
              {messages.exchanges.getLink}
              <ExternalLink />
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">{children}</p>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border bg-muted/40 p-8 text-muted-foreground">{children}</p>
  );
}

export async function HomeContent({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  let cards: PublicOfferCard[] = [];
  let stats = { exchangeCount: 0 };
  try {
    [cards, stats] = await Promise.all([listPublishedOfferCards(locale), getPublicStats()]);
  } catch {
    /* DB may not be bootstrapped during build. */
  }
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <CashbackLookup locale={locale} exchanges={[...new Map(cards.map(card => [card.exchange.id, { id: card.exchange.id, name: card.exchange.name }])).values()]} />
      <Eyebrow>{messages.home.eyebrow}</Eyebrow>
      <h1 className="max-w-3xl text-5xl font-bold tracking-tight text-foreground sm:text-6xl">{messages.home.title}</h1>
      <p className="mt-6 max-w-xl text-lg text-muted-foreground">{messages.home.lead}</p>

      <div className="mt-12 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {cards.slice(0, 12).map((card) => <OfferCard key={card.offerId} card={card} locale={locale} />)}
      </div>
      {!cards.length && (
        <div className="mt-12">
          <EmptyState>{messages.home.empty}</EmptyState>
        </div>
      )}
      {cards.length > 0 && (
        <div className="mt-8">
          <Link href={localePath(locale, "/exchanges")} className="text-sm font-medium text-primary hover:underline">
            {messages.home.viewOffer}
            <ArrowRight className="ml-1 inline size-4" />
          </Link>
        </div>
      )}

      <section className="mt-20 border-t border-border pt-12">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{messages.home.statsTitle}</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-3">
          <StatBlock value={marketingStatsPlaceholder.userCount} label={messages.home.statsUsers} />
          <StatBlock value={marketingStatsPlaceholder.countryCount} label={messages.home.statsCountries} />
          <StatBlock value={`${stats.exchangeCount}+`} label={messages.home.statsExchanges} />
        </div>
      </section>

      <RebateLedgerDemo locale={locale} />
    </main>
  );
}

function StatBlock({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <p className="text-4xl font-bold text-primary">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Preview of the future rebate ledger, backed ONLY by `generateLedgerDemoRows`
 * (deterministic demo data — see content/ledger-demo.ts). This is not connected to any
 * wallet/commission table and must not be, until real attribution data exists. The
 * "illustrative example" badge is intentionally not decorative: remove it only once this
 * table is rewired to real `WalletEntry` data.
 */
function RebateLedgerDemo({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const rows = generateLedgerDemoRows(20);
  return (
    <section className="mt-20 border-t border-border pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{messages.home.ledgerTitle}</h2>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {messages.home.ledgerDemoBadge}
        </Badge>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{messages.home.ledgerLead}</p>
      <div className="mt-6 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColExchange}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColRate}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColUid}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColRebate}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColDate}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0 odd:bg-muted/10">
                <td className="px-4 py-2.5 text-foreground">{row.exchange}</td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.ratePercent}%</td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.maskedUid}</td>
                <td className="px-4 py-2.5 font-medium text-primary">
                  {row.rebateAmount} {row.asset}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{row.date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export async function ExchangesContent({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const cards = await listPublishedOfferCards(locale);
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <Eyebrow>{messages.exchanges.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{messages.exchanges.title}</h1>
      <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {cards.map((card) => <OfferCard key={card.offerId} card={card} locale={locale} />)}
      </div>
      {!cards.length && (
        <div className="mt-10">
          <EmptyState>{messages.exchanges.empty}</EmptyState>
        </div>
      )}
    </main>
  );
}

export async function ExchangeContent({ locale, slug }: { locale: Locale; slug: string }) {
  const messages = getMessages(locale);
  const exchange = await getPublishedExchange(slug, locale);
  if (!exchange) notFound();
  const offerCards = await getExchangeOfferCards(slug, locale);
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <Eyebrow>{messages.exchange.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{exchange.name}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{exchange.description}</p>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {offerCards.map((card) => <OfferDetailCard key={card.offerId} card={card} locale={locale} />)}
      </div>
    </main>
  );
}

export async function GuidesContent({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const guides = await listPublishedGuides(locale);
  return (
    <main className="mx-auto max-w-6xl px-6 py-16">
      <Eyebrow>{messages.guides.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{messages.guides.title}</h1>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {guides.map((guide) => (
          <Link key={guide.id} href={localePath(locale, `/guides/${guide.slug}`)} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <CardHeader>
                <CardTitle>{guide.title ?? guide.slug}</CardTitle>
                <p className="text-sm text-muted-foreground">{guide.exchange?.name ?? messages.guides.general}</p>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
      {!guides.length && (
        <div className="mt-10">
          <EmptyState>{messages.guides.empty}</EmptyState>
        </div>
      )}
    </main>
  );
}

export async function GuideContent({ locale, slug }: { locale: Locale; slug: string }) {
  const messages = getMessages(locale);
  const guide = await getPublishedGuide(slug, locale);
  if (!guide) notFound();
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Eyebrow>{messages.guide.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{guide.title ?? guide.slug}</h1>
      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{guide.content ?? messages.guide.comingSoon}</p>
    </main>
  );
}

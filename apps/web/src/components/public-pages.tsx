import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
  getExchangeOfferCards,
  listPublishedExchanges,
  getPublishedExchange,
  getPublishedGuide,
  listPublishedGuides,
  listPublishedOfferCards,
  type PublicOfferCard
} from "@cashback/core";
import { getMessages, localePath, type Locale } from "../i18n";
import { calculateOpportunity, sharePercent } from "../lib/opportunity";
import { generateLedgerDemoRows } from "../content/ledger-demo";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { CashbackLookup } from "./cashback-lookup";
import { AuroraHero } from "./public/aurora-hero";
import { OpportunityCheck } from "./public/opportunity-check";
import { ExchangeLogo } from "./public/exchange-logo";
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
function exampleBack(rate: string): string {
  return calculateOpportunity("100", "100", rate)?.monthly ?? "—";
}

/** Published data stays server-rendered; the image alone handles a missing logo. */
function OfferCard({ card, locale }: { card: PublicOfferCard; locale: Locale }) {
  const m = getMessages(locale).aurora;
  return <article className="aurora-offer-card">
    <div className="aurora-offer-top"><ExchangeLogo name={card.exchange.name} src={card.exchange.logoUrl} /><span className="aurora-offer-tag">{m.publishedOffer}</span></div>
    <div className="aurora-offer-rate"><strong>{sharePercent(card.cashbackRate) ?? "—"}%</strong><span>{m.offerShare}</span></div>
    <p className="aurora-offer-description">{getMessages(locale).exchanges.exampleTemplate.replace("{{amount}}", exampleBack(card.cashbackRate))}</p>
    <p className="aurora-offer-conditions">{conditionsText(card.conditions, getMessages(locale).exchanges.conditionsFallback)}</p>
    <Link className="aurora-btn full" href={localePath(locale, "/exchanges/" + card.exchange.slug)}>{m.viewDetails}<ArrowRight size={16} aria-hidden="true" /></Link>
  </article>;
}

/** Full published offer details and referral links on the exchange page. */
function OfferDetailCard({ card, locale }: { card: PublicOfferCard; locale: Locale }) {
  const messages = getMessages(locale);
  const ratePercent = sharePercent(card.cashbackRate) ?? "—";
  return (
    <Card className="flex h-full flex-col justify-between transition-shadow hover:shadow-md">
      <CardHeader>
        <ExchangeLogo name={card.exchange.name} src={card.exchange.logoUrl} decorative /><CardTitle>{card.exchange.name}</CardTitle>
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
            {messages.exchanges.exampleTemplate.replace("{{amount}}", exampleBack(card.cashbackRate))}
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
  const m = getMessages(locale).aurora;
  const [offerResult, exchangeResult] = await Promise.allSettled([listPublishedOfferCards(locale), listPublishedExchanges(locale)]);
  const cards = offerResult.status === "fulfilled" ? offerResult.value : [];
  const exchanges = exchangeResult.status === "fulfilled" ? exchangeResult.value : [];
  const order = ["bybit", "binance", "mexc"];
  const rank = (slug: string) => { const value = order.indexOf(slug); return value < 0 ? order.length : value; };
  const orderedCards = [...cards].sort((a, b) => rank(a.exchange.slug) - rank(b.exchange.slug));
  const orderedExchanges = [...exchanges].sort((a, b) => rank(a.slug) - rank(b.slug));
  return <main id="main-content" className="aurora-wrap aurora-home">
    <AuroraHero locale={locale} />
    <OpportunityCheck locale={locale} offers={orderedCards.map(card => ({ id: card.offerId, exchangeId: card.exchange.id, exchangeName: card.exchange.name, slug: card.exchange.slug, commissionVolumeRate: card.exchange.commissionVolumeRate, cashbackRate: card.cashbackRate }))} />
    {orderedExchanges.length > 0 && <div className="aurora-exchange-strip" aria-label={getMessages(locale).exchanges.title}>{orderedExchanges.map(exchange => <Link key={exchange.id} href={localePath(locale, "/exchanges/" + exchange.slug)}><ExchangeLogo name={exchange.name} src={exchange.logoUrl} /></Link>)}</div>}
    <CashbackLookup locale={locale} exchanges={orderedExchanges.map(exchange => ({ id: exchange.id, name: exchange.name }))} />
    <section id="offers" className="aurora-section"><div className="aurora-section-heading"><p className="aurora-eyebrow">{m.offersEyebrow}</p><h2>{m.offersTitle}</h2><p>{m.offersLead}</p></div>
      {orderedCards.length ? <div className="aurora-offer-grid">{orderedCards.map(card => <OfferCard key={card.offerId} card={card} locale={locale} />)}</div> : <EmptyState>{offerResult.status === "rejected" ? m.offersUnavailable : m.offersEmpty}</EmptyState>}
      <p className="aurora-data-note">{m.offersNote}</p>
    </section>
    <section id="how-it-works" className="aurora-section aurora-divider"><p className="aurora-eyebrow">{m.howEyebrow}</p><h2>{m.howTitle}</h2><div className="aurora-steps">{m.steps.map(step => <article key={step.number}><p className="aurora-step-num">{step.number}</p><h3>{step.title}</h3><p>{step.lead}</p></article>)}</div></section>
    <RebateLedgerDemo locale={locale} />
    <section id="faq" className="aurora-section aurora-divider aurora-faq"><div><p className="aurora-eyebrow">{m.faqEyebrow}</p><h2>{m.faqTitle}</h2><p>{m.faqLead}</p></div><div>{m.questions.map((question, index) => <details key={question.title} open={index === 0}><summary>{question.title}</summary><p>{question.answer}</p></details>)}</div></section>
  </main>;
}

/**
 * Interim marketing ticker (Req 17): 100 deterministic large fake credits.
 * Not WalletEntry. Keep the illustrative badge until live credits replace this.
 */
function RebateLedgerRow({ row, copy = false }: { row: ReturnType<typeof generateLedgerDemoRows>[number]; copy?: boolean }) {
  return (
    <tr aria-hidden={copy || undefined} data-ticker-copy={copy ? "" : undefined} className="border-b border-border/60 odd:bg-muted/10">
      <td className="px-4 py-2.5 text-foreground">{row.exchange}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{row.ratePercent}%</td>
      <td className="px-4 py-2.5 text-muted-foreground">{row.maskedUid}</td>
      <td className="px-4 py-2.5 font-medium text-primary">{row.rebateAmount} {row.asset}</td>
      <td className="px-4 py-2.5 text-muted-foreground">{row.date}</td>
    </tr>
  );
}

function RebateLedgerDemo({ locale }: { locale: Locale }) {
  const messages = getMessages(locale);
  const rows = generateLedgerDemoRows(100);
  return (
    <section className="mt-20 border-t border-border pt-12">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-2xl font-bold tracking-tight text-foreground">{messages.home.ledgerTitle}</h2>
        <Badge variant="outline" className="text-xs text-muted-foreground">
          {messages.home.ledgerDemoBadge}
        </Badge>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{messages.home.ledgerLead}</p>
      <div className="rebate-ticker mt-6 rounded-xl border border-border" tabIndex={0} aria-label={messages.home.ledgerTitle}>
        <table className="w-full table-fixed text-left text-sm">
          <thead className="rebate-ticker-head">
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColExchange}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColRate}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColUid}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColRebate}</th>
              <th className="px-4 py-3 font-medium">{messages.home.ledgerColDate}</th>
            </tr>
          </thead>
          <tbody className="rebate-ticker-track">
            {rows.map((row, index) => <RebateLedgerRow key={`${row.maskedUid}-${row.date}-${index}`} row={row} />)}
            {rows.map((row, index) => <RebateLedgerRow key={`copy-${row.maskedUid}-${row.date}-${index}`} row={row} copy />)}
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
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-16">
      <Eyebrow>{messages.exchanges.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{messages.exchanges.title}</h1>
      <div className="mt-10 aurora-offer-grid">
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
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-16">
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
    <main id="main-content" className="mx-auto max-w-6xl px-6 py-16">
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
    <main id="main-content" className="mx-auto max-w-3xl px-6 py-16">
      <Eyebrow>{messages.guide.eyebrow}</Eyebrow>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{guide.title ?? guide.slug}</h1>
      <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{guide.content ?? messages.guide.comingSoon}</p>
    </main>
  );
}

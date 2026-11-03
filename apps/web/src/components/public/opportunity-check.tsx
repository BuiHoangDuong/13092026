"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getMessages, localePath, type Locale } from "../../i18n";
import { calculateVolumeEstimate, formatVolume, normalizeVolume } from "../../lib/opportunity";

export type EstimateOffer = { id: string; exchangeId: string; exchangeName: string; slug: string };
export function OpportunityCheck({ offers, locale }: { offers: EstimateOffer[]; locale: Locale }) {
  const m = getMessages(locale).aurora;
  const [exchangeId, setExchangeId] = useState(offers[0]?.exchangeId ?? "");
  const [volume, setVolume] = useState("1,000,000");
  const selected = offers.find(offer => offer.exchangeId === exchangeId) ?? offers[0];
  if (exchangeId !== (selected?.exchangeId ?? "")) setExchangeId(selected?.exchangeId ?? "");
  const exchanges = [...new Map(offers.map(offer => [offer.exchangeId, offer])).values()];
  const estimate = selected ? calculateVolumeEstimate(volume) : null;
  const offerHref = selected ? localePath(locale, `/exchanges/${selected.slug}#offer-${selected.id}`) : null;
  const invalid = Boolean(selected && !estimate);
  return <section className="aurora-opportunity" id="opportunity" aria-labelledby="opportunity-title">
    <div className="aurora-opportunity-top"><div><p className="aurora-kicker">{m.opportunityKicker}</p><h2 id="opportunity-title">{m.opportunityTitle}</h2></div><span className="aurora-pill">{m.estimateBadge}</span></div>
    <div className="aurora-opportunity-grid">
      <form className="aurora-opportunity-form" noValidate onSubmit={event => { event.preventDefault(); }}>
        <label htmlFor="opportunity-exchange">{m.whereTrade}</label><select id="opportunity-exchange" value={selected?.exchangeId ?? ""} disabled={!offers.length} onChange={event => setExchangeId(event.target.value)}>
          {!offers.length && <option value="">{m.noOffers}</option>}{exchanges.map(offer => <option key={offer.exchangeId} value={offer.exchangeId}>{offer.exchangeName}</option>)}
        </select>
        <label htmlFor="monthly-volume">{m.monthlyVolume}</label><div className="aurora-money-field"><input id="monthly-volume" name="monthlyVolume" type="text" maxLength={32} inputMode="decimal" value={volume} onFocus={() => setVolume(value => normalizeVolume(value) ?? value)} onBlur={() => setVolume(formatVolume)} onChange={event => setVolume(event.target.value)} aria-describedby="opportunity-model opportunity-error" aria-invalid={invalid} disabled={!selected} /><span>USDT</span></div>
        <div className="aurora-fee-presets" aria-label={m.volumePresets}>{["100000", "1000000", "5000000"].map(amount => <button key={amount} type="button" disabled={!selected} aria-pressed={normalizeVolume(volume) === amount} onClick={() => setVolume(formatVolume(amount))}>{formatVolume(amount)} USDT</button>)}</div>
        <button className="aurora-btn full" type="submit" disabled={!selected}>{m.calculate}<ArrowRight size={16} aria-hidden="true" /></button>
        <p id="opportunity-error" role="alert" className="aurora-error" hidden={!invalid}>{m.invalidEstimate}</p>
        {!selected && <p role="status" className="aurora-muted">{m.noOffers}</p>}
      </form>
      <div className="aurora-opportunity-result"><p className="aurora-result-kicker">{m.resultKicker}</p>
        <div aria-live="polite" aria-atomic="true"><div className="aurora-opportunity-amount"><output id="opportunity-monthly" htmlFor="monthly-volume opportunity-exchange">{estimate?.monthly ?? "—"}</output><span>USDT</span></div><p className="aurora-opportunity-period">{m.perMonth}</p><div className="aurora-opportunity-year"><span>{m.overYear}</span><strong>{estimate ? `${estimate.annual} USDT` : "—"}</strong></div></div>
        <p className="aurora-opportunity-nudge">{estimate ? m.nudge.replace("{{amount}}", estimate.monthly) : m.adjustInputs}</p>
        {offerHref && <Link className="aurora-btn primary full" href={offerHref}>{m.checkMine}<ArrowRight size={16} aria-hidden="true" /></Link>}
        {offerHref && <Link className="aurora-opportunity-link" href={offerHref}>{m.findEligible}<ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>
    </div>
    <div className="aurora-opportunity-footnote"><ShieldCheck size={20} aria-hidden="true" /><p><span id="opportunity-model">{estimate ? m.model.replace("{{volume}}", estimate.volume).replace("{{rate}}", estimate.ratePercent) : m.adjustInputs}</span><br />{m.eligibilityNote}</p></div>
  </section>;
}

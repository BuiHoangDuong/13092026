"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { getMessages, localePath, type Locale } from "../../i18n";
import { calculateOpportunity, sharePercent } from "../../lib/opportunity";

export type EstimateOffer = { id: string; exchangeId: string; exchangeName: string; slug: string; rate: string };
export function OpportunityCheck({ offers, locale }: { offers: EstimateOffer[]; locale: Locale }) {
  const m = getMessages(locale).aurora;
  const validOffers = offers.filter(offer => sharePercent(offer.rate) !== null);
  const defaultOffer = validOffers.find(offer => offer.slug === "bybit") ?? validOffers[0];
  const [offerId, setOfferId] = useState(defaultOffer?.id ?? "");
  const [fees, setFees] = useState("500");
  const [commission, setCommission] = useState("50");
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const selected = validOffers.find(offer => offer.id === offerId) ?? defaultOffer;
  const exchangeOffers = validOffers.filter(offer => offer.exchangeId === selected?.exchangeId);
  const exchanges = [...new Map(validOffers.map(offer => [offer.exchangeId, offer])).values()];
  const estimate = selected ? calculateOpportunity(fees, commission, selected.rate) : null;
  const share = selected ? sharePercent(selected.rate) ?? "—" : "—";
  const invalid = Boolean(selected && !estimate);
  return <section className="aurora-opportunity" id="opportunity" aria-labelledby="opportunity-title">
    <div className="aurora-opportunity-top"><div><p className="aurora-kicker">{m.opportunityKicker}</p><h2 id="opportunity-title">{m.opportunityTitle}</h2></div><span className="aurora-pill">{m.estimateBadge}</span></div>
    <div className="aurora-opportunity-grid">
      <form className="aurora-opportunity-form" noValidate onSubmit={event => { event.preventDefault(); if (invalid) setAssumptionsOpen(true); }}>
        <label htmlFor="opportunity-exchange">{m.whereTrade}</label><select id="opportunity-exchange" value={selected?.exchangeId ?? ""} disabled={!validOffers.length} onChange={event => setOfferId(validOffers.find(offer => offer.exchangeId === event.target.value)?.id ?? "")}>
          {!validOffers.length && <option value="">{m.noOffers}</option>}{exchanges.map(offer => <option key={offer.exchangeId} value={offer.exchangeId}>{offer.exchangeName}</option>)}
        </select>
        {exchangeOffers.length > 1 && <><label htmlFor="opportunity-offer">{m.chooseOffer}</label><select id="opportunity-offer" value={selected?.id ?? ""} onChange={event => setOfferId(event.target.value)}>{exchangeOffers.map((offer, index) => <option key={offer.id} value={offer.id}>{m.offerOption.replace("{{index}}", String(index + 1)).replace("{{share}}", sharePercent(offer.rate) ?? "—")}</option>)}</select></>}
        <label htmlFor="monthly-fees">{m.monthlyFees}</label><div className="aurora-money-field"><input id="monthly-fees" name="monthlyFees" type="number" min="0" max="1000000" step="any" inputMode="decimal" value={fees} onChange={event => setFees(event.target.value)} aria-describedby="opportunity-model opportunity-error" aria-invalid={Boolean(selected && !calculateOpportunity(fees, "0", "0"))} disabled={!selected} /><span>USDT</span></div>
        <div className="aurora-fee-presets" aria-label={m.feePresets}>{["100", "500", "1000"].map(amount => <button key={amount} type="button" disabled={!selected} aria-pressed={fees === amount} onClick={() => setFees(amount)}>{Number(amount).toLocaleString("en-US")} USDT</button>)}</div>
        <div className="aurora-opportunity-rate"><span>{m.cashbackShare}</span><strong>{share}% <small>{m.ofCommission}</small></strong></div>
        <details className="aurora-assumptions" open={assumptionsOpen} onToggle={event => setAssumptionsOpen(event.currentTarget.open)}><summary>{m.assumptions}</summary><label htmlFor="commission-percent">{m.commissionLabel}</label><input id="commission-percent" type="number" min="0" max="100" step="any" inputMode="decimal" value={commission} onChange={event => setCommission(event.target.value)} aria-describedby="commission-note opportunity-error" aria-invalid={Boolean(selected && !calculateOpportunity("0", commission, "0"))} disabled={!selected} /><p id="commission-note">{m.commissionNote}</p></details>
        <button className="aurora-btn full" type="submit" disabled={!selected}>{m.calculate}<ArrowRight size={16} aria-hidden="true" /></button>
        <p id="opportunity-error" role="alert" className="aurora-error" hidden={!invalid}>{m.invalidEstimate}</p>
        {!selected && <p role="status" className="aurora-muted">{m.noOffers}</p>}
      </form>
      <div className="aurora-opportunity-result"><p className="aurora-result-kicker">{m.resultKicker}</p>
        <div aria-live="polite" aria-atomic="true"><div className="aurora-opportunity-amount"><output id="opportunity-monthly" htmlFor={`monthly-fees commission-percent opportunity-exchange${exchangeOffers.length > 1 ? " opportunity-offer" : ""}`}>{estimate?.monthly ?? "—"}</output><span>USDT</span></div><p className="aurora-opportunity-period">{m.perMonth}</p><div className="aurora-opportunity-year"><span>{m.overYear}</span><strong>{estimate ? `${estimate.annual} USDT` : "—"}</strong></div></div>
        <p className="aurora-opportunity-nudge">{estimate && !estimate.zero ? m.nudge.replace("{{amount}}", estimate.monthly) : m.adjustInputs}</p>
        <Link className="aurora-btn primary full" href="#lookup">{m.checkMine}<ArrowRight size={16} aria-hidden="true" /></Link>
        {selected && <Link className="aurora-opportunity-link" href={localePath(locale, `/exchanges/${selected.slug}`)}>{m.findEligible}<ArrowRight size={14} aria-hidden="true" /></Link>}
      </div>
    </div>
    <div className="aurora-opportunity-footnote"><ShieldCheck size={20} aria-hidden="true" /><p><span id="opportunity-model">{estimate ? m.model.replace("{{fees}}", estimate.fees).replace("{{commission}}", commission).replace("{{share}}", share) : m.adjustInputs}</span><br />{m.eligibilityNote}</p></div>
  </section>;
}

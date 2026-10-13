import Link from "next/link";
import { ArrowRight, ArrowUpRight, CircleDot } from "lucide-react";
import { getMessages, type Locale } from "../../i18n";
export function AuroraHero({ locale }: { locale: Locale }) {
  const m = getMessages(locale).aurora;
  return <section className="aurora-hero" aria-labelledby="hero-title">
    <span className="aurora-label-dot">{m.heroEyebrow}</span>
    <h1 id="hero-title">{m.heroTitle}<br /><em>{m.heroAccent}</em></h1>
    <p className="aurora-lead">{m.heroLead}</p>
    <div className="aurora-actions"><Link className="aurora-btn primary" href="#offers">{m.findExchange}<ArrowRight size={16} aria-hidden="true" /></Link><Link className="aurora-btn" href="#lookup">{m.checkMine}</Link></div>
    <div className="aurora-benefits">{m.benefits.map(text => <span key={text}>{text}</span>)}</div>
    <div className="aurora-stage">
      <div className="aurora-wallet"><div className="aurora-surface-label"><span>{m.walletIllustration}</span><span>USDT</span></div>
        <div className="aurora-wallet-core"><div><p className="aurora-wallet-title">{m.available}</p><p className="aurora-balance">248.50<span>USDT</span></p><p className="aurora-wallet-caption">{m.illustrativeBalance}</p></div><Link className="aurora-btn primary" href="#lookup">{m.viewBalance}<ArrowRight size={15} aria-hidden="true" /></Link></div>
        <div className="aurora-balance-summary"><div><span>{m.pending}</span><strong>42.80 <small>USDT</small></strong></div><div><span>{m.paid}</span><strong>1,206.00 <small>USDT</small></strong></div></div>
        <div className="aurora-mini-status"><span>{m.exampleCredit}</span><strong>+32.40 USDT</strong></div>
      </div>
      <div className="aurora-orbit-note"><ArrowUpRight size={20} aria-hidden="true" /><strong>{m.orbitOne}</strong><p>{m.orbitOneLead}</p></div>
      <div className="aurora-orbit-note right"><CircleDot size={20} aria-hidden="true" /><strong>{m.orbitTwo}</strong><p>{m.orbitTwoLead}</p></div>
      <p className="aurora-caption">{m.illustrationNote}</p>
    </div>
  </section>;
}

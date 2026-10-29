"use client";
import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { getMessages, localePath, type Locale } from "../../i18n";
import { site } from "../../lib/site";

export function PublicShell({ children, locale, legacyHeader, legacyFooter }: {
  children: ReactNode; locale: Locale; legacyHeader: ReactNode; legacyFooter: ReactNode;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const m = getMessages(locale).aurora;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return <>{legacyHeader}{children}{legacyFooter}</>;
  const home = localePath(locale, "/");
  const links = [
    { href: `${home}#opportunity`, label: m.navOpportunity },
    { href: localePath(locale, "/exchanges"), label: m.navOffers },
    { href: `${home}#how-it-works`, label: m.navHow },
    { href: localePath(locale, "/guides"), label: m.navGuides }
  ];
  const [brandStrong, ...brandRest] = site.name.split(" ");
  const brand = <><span className="aurora-brand-mark"><ArrowUpRight size={20} aria-hidden="true" /></span>{brandStrong}{brandRest.length > 0 && <span className="aurora-brand-light">{brandRest.join(" ")}</span>}</>;
  return <div className="public-aurora">
    <a className="aurora-skip" href="#main-content">{m.skip}</a>
    <header className="aurora-header" onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); toggle.current?.focus(); } }}>
      <div className="aurora-wrap aurora-header-inner">
        <Link href={home} className="aurora-brand" aria-label={`${site.name} home`} onClick={() => setOpen(false)}>{brand}</Link>
        <nav className="aurora-desktop-nav" aria-label={m.navigation}>{links.map(link => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
        <div className="aurora-header-actions"><Link className="aurora-btn" href={`${home}#lookup`}>{m.check}</Link>
          <button ref={toggle} className="aurora-menu-toggle" type="button" aria-label={open ? m.closeMenu : m.openMenu} aria-expanded={open} aria-controls="public-mobile-nav" onClick={() => setOpen(!open)}>{open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}</button>
        </div>
      </div>
      <nav id="public-mobile-nav" className="aurora-mobile-nav aurora-wrap" aria-label={m.mobileNavigation} hidden={!open}>{links.map(link => <Link key={link.href} href={link.href} onClick={() => setOpen(false)}>{link.label}</Link>)}</nav>
    </header>
    {children}
    <footer className="aurora-footer"><div className="aurora-wrap aurora-footer-inner"><Link href={home} className="aurora-brand" aria-label={`${site.name} home`}>{brand}</Link><nav aria-label={m.footerNavigation}><Link href={localePath(locale, "/exchanges")}>{m.navOffers}</Link><Link href={localePath(locale, "/guides")}>{m.navGuides}</Link><Link href={`${home}#faq`}>{m.faq}</Link></nav><p>{m.footerNote}</p></div></footer>
  </div>;
}

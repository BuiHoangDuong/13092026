import Link from "next/link";
import { auth, getWallet, listUidLinks } from "@cashback/core";
import { db } from "@cashback/db";
import { sessionToken } from "../lib/auth";
import { getMessages, type Locale } from "../i18n";
import { CashbackDashboard } from "./cashback-dashboard";
import { Button } from "./ui/button";

export async function CashbackPanel({ locale, detailed = false }: { locale: Locale; detailed?: boolean }) {
  const m = getMessages(locale).cashback;
  let content;
  try {
    const principal = await auth.getSession(await sessionToken());
    if (!principal || principal.type !== "CUSTOMER") {
      content = <div className="space-y-5"><p className="max-w-2xl text-muted-foreground">{m.guest}</p><Button asChild size="lg"><Link href="/login">{m.signIn}</Link></Button></div>;
    } else {
      const [wallet, links, bybit] = await Promise.all([
        getWallet(principal.id), listUidLinks(principal.id),
        db.exchange.findFirst({ where: { slug: "bybit", status: "PUBLISHED" }, select: { id: true } })
      ]);
      content = <CashbackDashboard wallet={wallet} links={links} exchangeId={bybit?.id ?? null} email={principal.email} messages={m} detailed={detailed} />;
    }
  } catch (error) {
    console.error("cashback_panel_failed", error);
    content = <p role="alert" className="text-muted-foreground">{m.unavailable}</p>;
  }
  return <section aria-labelledby="cashback-title" className="mb-12 rounded-2xl border border-primary/40 bg-card p-6 shadow-lg sm:p-8">
    <div className="mb-6"><h2 id="cashback-title" className="text-3xl font-bold">{m.title}</h2><p className="mt-2 text-muted-foreground">{m.lead}</p></div>
    {content}
  </section>;
}

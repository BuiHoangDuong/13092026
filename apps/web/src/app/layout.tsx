import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { defaultLocale, getMessages, isLocale, localePath } from "../i18n";
import { LocaleProvider } from "../i18n/locale-provider";
import "./globals.css";

export const metadata: Metadata = { title: "Cashback Hub", description: "Crypto exchange cashback, made transparent." };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const requestedLocale = (await headers()).get("x-cashback-locale") ?? defaultLocale;
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  const messages = getMessages(locale);
  return (
    <html lang={locale}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <LocaleProvider locale={locale} messages={messages}>
          <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
              <Link href={localePath(locale, "/")} className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
                  $
                </span>
                Cashback Hub
              </Link>
              <nav className="flex items-center gap-5 text-sm font-medium text-muted-foreground">
                <Link href={localePath(locale, "/exchanges")} className="transition-colors hover:text-foreground">
                  {messages.nav.exchanges}
                </Link>
                <Link href={localePath(locale, "/guides")} className="transition-colors hover:text-foreground">
                  {messages.nav.guides}
                </Link>
              </nav>
              <div className="ml-auto flex items-center gap-4 text-sm font-medium text-muted-foreground">
                <Link href="/me/wallet" className="transition-colors hover:text-foreground">
                  {messages.nav.wallet}
                </Link>
              </div>
            </div>
          </header>
          {children}
          <footer className="border-t border-border">
            <div className="mx-auto max-w-6xl px-6 py-14">
              <Link href={localePath(locale, "/")} className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground">
                <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm text-primary-foreground">
                  $
                </span>
                {messages.siteFooter.brand}
              </Link>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">{messages.siteFooter.tagline}</p>

              <div className="mt-10 grid grid-cols-2 gap-8 sm:grid-cols-4">
                {messages.siteFooter.columns.map((column) => (
                  <div key={column.title}>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground">{column.title}</h3>
                    <ul className="mt-4 space-y-2.5">
                      {column.items.map((item) => (
                        <li key={item}>
                          <Link href={localePath(locale, "/")} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                            {item}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
                <p>{messages.siteFooter.disclaimer}</p>
                <p className="mt-1">{messages.siteFooter.placeholderNote}</p>
              </div>
            </div>
          </footer>
        </LocaleProvider>
      </body>
    </html>
  );
}

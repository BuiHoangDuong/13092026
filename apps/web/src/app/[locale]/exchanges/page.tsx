import { notFound } from "next/navigation";
import { ExchangesContent } from "../../../components/public-pages";
import { isPrefixedLocale } from "../../../i18n";

export const dynamic = "force-dynamic";
export default async function LocalizedExchangesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isPrefixedLocale(locale)) notFound();
  return <ExchangesContent locale={locale} />;
}

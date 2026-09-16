import { notFound } from "next/navigation";
import { ExchangeContent } from "../../../../components/public-pages";
import { isPrefixedLocale } from "../../../../i18n";

export const dynamic = "force-dynamic";
export default async function LocalizedExchangePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isPrefixedLocale(locale)) notFound();
  return <ExchangeContent locale={locale} slug={slug} />;
}

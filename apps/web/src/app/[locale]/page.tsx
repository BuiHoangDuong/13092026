import { notFound } from "next/navigation";
import { HomeContent } from "../../components/public-pages";
import { isPrefixedLocale } from "../../i18n";

export const dynamic = "force-dynamic";
export default async function LocalizedHomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isPrefixedLocale(locale)) notFound();
  return <HomeContent locale={locale} />;
}

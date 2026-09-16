import { notFound } from "next/navigation";
import { GuideContent } from "../../../../components/public-pages";
import { isPrefixedLocale } from "../../../../i18n";

export const dynamic = "force-dynamic";
export default async function LocalizedGuidePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isPrefixedLocale(locale)) notFound();
  return <GuideContent locale={locale} slug={slug} />;
}

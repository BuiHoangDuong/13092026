import { ExchangeContent } from "../../../components/public-pages";
import { defaultLocale } from "../../../i18n";

export const dynamic = "force-dynamic";
export default async function ExchangePage({ params }: { params: Promise<{ slug: string }> }) {
  return <ExchangeContent locale={defaultLocale} slug={(await params).slug} />;
}

import { ExchangesContent } from "../../components/public-pages";
import { defaultLocale } from "../../i18n";

export const dynamic = "force-dynamic";
export default async function ExchangesPage() {
  return <ExchangesContent locale={defaultLocale} />;
}

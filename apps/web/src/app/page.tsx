import { HomeContent } from "../components/public-pages";
import { defaultLocale } from "../i18n";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  return <HomeContent locale={defaultLocale} />;
}

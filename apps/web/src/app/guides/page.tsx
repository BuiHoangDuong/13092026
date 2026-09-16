import { GuidesContent } from "../../components/public-pages";
import { defaultLocale } from "../../i18n";

export const dynamic = "force-dynamic";
export default async function GuidesPage() {
  return <GuidesContent locale={defaultLocale} />;
}

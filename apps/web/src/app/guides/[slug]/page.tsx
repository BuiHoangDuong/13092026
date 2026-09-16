import { GuideContent } from "../../../components/public-pages";
import { defaultLocale } from "../../../i18n";

export const dynamic = "force-dynamic";
export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  return <GuideContent locale={defaultLocale} slug={(await params).slug} />;
}

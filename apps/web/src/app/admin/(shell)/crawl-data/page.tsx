import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/require-admin-page";

export default async function RetiredCrawlDataPage() {
  await requireAdminPage();
  redirect("/admin/ingest/uploads");
}

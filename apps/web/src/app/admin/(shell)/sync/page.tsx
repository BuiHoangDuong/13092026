import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/require-admin-page";

export default async function RetiredSyncPage() {
  await requireAdminPage();
  redirect("/admin/ingest/connectors");
}

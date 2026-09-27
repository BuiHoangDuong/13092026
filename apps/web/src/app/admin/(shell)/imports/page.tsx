import { redirect } from "next/navigation";
import { requireAdminPage } from "@/lib/require-admin-page";

export default async function RetiredImportsPage() {
  await requireAdminPage();
  redirect("/admin/ingest/uploads");
}

import { requireAdminPage } from "@/lib/require-admin-page";
import { AdminNav } from "../admin-nav";
import { AdminExchangeListProvider } from "../content-forms";

export const dynamic = "force-dynamic";

export default async function AdminShellLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <div className="admin-shell">
      <AdminNav />
      <div className="admin-main"><AdminExchangeListProvider>{children}</AdminExchangeListProvider></div>
    </div>
  );
}

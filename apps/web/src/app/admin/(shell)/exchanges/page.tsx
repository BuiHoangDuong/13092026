import { AdminPage } from "../../admin-page";
import { AdminExchangesSection } from "../../content-forms";

export default function AdminExchangesPage() {
  return (
    <AdminPage title="Exchanges" description="Create, edit, publish, or unpublish exchange records. English fields only.">
      <AdminExchangesSection />
    </AdminPage>
  );
}

import { AdminPage } from "../../admin-page";
import { AdminOffersSection } from "../../content-forms";

export default function AdminOffersPage() {
  return (
    <AdminPage title="Offers" description="Cashback offers bound to a published exchange. English conditions only.">
      <AdminOffersSection />
    </AdminPage>
  );
}

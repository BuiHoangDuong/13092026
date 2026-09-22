import { AdminPage } from "../../admin-page";
import { AdminGuidesSection } from "../../content-forms";

export default function AdminGuidesPage() {
  return (
    <AdminPage title="Guides" description="Published how-to pages. Optional exchange association. English title and content.">
      <AdminGuidesSection />
    </AdminPage>
  );
}

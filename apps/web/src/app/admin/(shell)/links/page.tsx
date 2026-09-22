import { AdminPage } from "../../admin-page";
import { AdminLinksSection } from "../../content-forms";

export default function AdminLinksPage() {
  return (
    <AdminPage title="Referral links" description="Active destinations used by /go/:linkId. Same-exchange offer binding is required.">
      <AdminLinksSection />
    </AdminPage>
  );
}

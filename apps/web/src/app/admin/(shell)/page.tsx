import { AdminPage } from "../admin-page";
import { AnalyticsDashboard } from "../analytics-dashboard";

export default function AdminOverviewPage() {
  return (
    <AdminPage eyebrow="Operations" title="Overview" description="Click, attribution, import, and worker health. Use the left nav for imports, withdrawals, and content.">
      <AnalyticsDashboard />
    </AdminPage>
  );
}

import { listPublishedExchanges } from "@cashback/core";
import { AdminPage } from "../../../admin-page";
import { ActivityReport } from "../../../activity-report";

async function ReportSection() {
  const exchanges = (await listPublishedExchanges()).map(({ id, name }) => ({ id, name }));
  const todayUtc = new Date().toISOString().slice(0, 10);
  return <ActivityReport exchanges={exchanges} todayUtc={todayUtc} />;
}

export default async function ActivityReportPage() {
  return (
    <AdminPage title="Referral activity" description="Published referral metrics from manual uploads and API connectors. These figures are not cashback.">
      <ReportSection />
    </AdminPage>
  );
}

import { getPublishedExchangeId } from "@cashback/core";
import { AdminPage } from "../../../admin-page";
import { SyncControls } from "../../../sync-controls";

async function ConnectorSection() {
  const exchangeId = await getPublishedExchangeId("bybit");
  return <SyncControls exchangeId={exchangeId} />;
}

export default async function ConnectorsPage() {
  return (
    <AdminPage title="API connectors" description="Schedules for official exchange APIs. Bybit Affiliate is the first connector. Its reported commission is not cashback.">
      <ConnectorSection />
    </AdminPage>
  );
}

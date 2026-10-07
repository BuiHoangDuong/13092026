import { listSyncExchanges } from "@cashback/core";
import { AdminPage } from "../../../admin-page";
import { ConnectorSettings } from "../../../connector-settings";

async function ConnectorSection() {
  return <ConnectorSettings exchanges={await listSyncExchanges()} />;
}

export default async function ConnectorsPage() {
  return (
    <AdminPage title="API connectors" description="Choose an exchange and configure its own manual or scheduled API sync. Reported commission does not credit cashback.">
      <ConnectorSection />
    </AdminPage>
  );
}

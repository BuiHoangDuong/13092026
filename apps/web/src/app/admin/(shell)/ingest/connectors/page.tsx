import { getPublishedExchangeId } from "@cashback/core";
import { AdminPage } from "../../../admin-page";
import { SyncControls } from "../../../sync-controls";

async function ConnectorSection() {
  const [bybitId, mexcId] = await Promise.all([getPublishedExchangeId("bybit"), getPublishedExchangeId("mexc")]);
  return <>
    <SyncControls exchangeId={bybitId} exchangeSlug="bybit" />
    <SyncControls exchangeId={mexcId} exchangeSlug="mexc" />
  </>;
}

export default async function ConnectorsPage() {
  return (
    <AdminPage title="API connectors" description="Schedules for official Bybit and MEXC affiliate activity APIs. Reported commission does not credit cashback.">
      <ConnectorSection />
    </AdminPage>
  );
}

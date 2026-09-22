import { getPublishedExchangeId } from "@cashback/core";
import { AdminPage } from "../../admin-page";
import { BybitOperations } from "../../bybit-operations";

// A nested Server Component so the exchange lookup runs while AdminPage renders its
// children — i.e. after AdminPage's own requireAdminPage() call, not before it.
async function BybitImportsSection() {
  const exchangeId = await getPublishedExchangeId("bybit");
  return <BybitOperations exchangeId={exchangeId} />;
}

export default async function AdminImportsPage() {
  return (
    <AdminPage title="Bybit imports" description="Upload a normalized Bybit CSV, preview, then publish verified cashback.">
      <BybitImportsSection />
    </AdminPage>
  );
}

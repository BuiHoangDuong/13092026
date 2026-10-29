import { AdminPage } from "../../admin-page";
import { PayablesLedger } from "../../payables-ledger";

export default function AdminPayablesPage() {
  return (
    <AdminPage title="Payables" description="What each customer UID is owed, what was paid, and why a payout is still waiting. USDT is paid automatically at 23:00 UTC; amounts over 20 USDT wait for your approval.">
      <PayablesLedger />
    </AdminPage>
  );
}

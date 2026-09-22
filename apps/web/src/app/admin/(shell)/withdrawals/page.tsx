import { AdminPage } from "../../admin-page";
import { WithdrawalQueue } from "../../withdrawal-queue";

export default function AdminWithdrawalsPage() {
  return (
    <AdminPage title="Withdrawals" description="Review first withdrawals, approve or reject, then mark paid after you send funds off-platform.">
      <WithdrawalQueue />
    </AdminPage>
  );
}

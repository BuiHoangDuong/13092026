import { referralSnapshotQuerySchema } from "@cashback/contracts";
import { listReferralSnapshots } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

// Preserve the original snapshots[] contract for existing admin clients.
export const GET = (request: Request) => withAdmin(async () => {
  const params = new URL(request.url).searchParams;
  const parsed = referralSnapshotQuerySchema.parse({
    exchangeId: params.get("exchangeId") ?? "",
    periodStart: params.get("periodStart") ?? "",
    periodEnd: params.get("periodEnd") ?? "",
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined
  });
  return adminJson(await listReferralSnapshots(parsed));
});

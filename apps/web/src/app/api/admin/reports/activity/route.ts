import { activityReportResponseSchema, referralSnapshotQuerySchema } from "@cashback/contracts";
import { listReportedActivity } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => {
  const params = new URL(request.url).searchParams;
  const parsed = referralSnapshotQuerySchema.parse({
    exchangeId: params.get("exchangeId") ?? "",
    periodStart: params.get("periodStart") ?? "",
    periodEnd: params.get("periodEnd") ?? "",
    cursor: params.get("cursor") ?? undefined,
    limit: params.get("limit") ?? undefined
  });
  return adminJson(activityReportResponseSchema.parse(await listReportedActivity(parsed)));
});

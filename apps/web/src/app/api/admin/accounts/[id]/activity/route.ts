import { getAdminAccountActivity } from "@cashback/core";
import { adminJson, adminListOptions, withAdmin } from "@/lib/admin-api";

export const GET = (request: Request, { params }: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const { id } = await params;
  const options = adminListOptions(request);
  return adminJson(await getAdminAccountActivity(id, options.cursor, options.limit));
});

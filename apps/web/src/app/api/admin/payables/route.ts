import { payableListQuerySchema } from "@cashback/contracts";
import { listPayables } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
export const GET = (request: Request) => withAdmin(async () => {
  const query = payableListQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return adminJson(await listPayables(query));
});

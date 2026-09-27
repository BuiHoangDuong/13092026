import { requestRetransform } from "@cashback/core";
import { adminJson, withAdminMutation } from "@/lib/admin-api";

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdminMutation(request, async (principal) => {
  const { id } = await context.params;
  return adminJson(await requestRetransform(principal.id, id), { status: 202 });
});

import { decideWithdrawal } from "@cashback/core";
import { adminJson, withAdminMutation } from "@/lib/admin-api";
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdminMutation(request, async principal => {
  return adminJson(await decideWithdrawal(principal.id, (await context.params).id, await request.json()));
});

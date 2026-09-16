import { decideWithdrawal } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
import { sameOrigin } from "@/lib/uid-api";
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async principal => {
  sameOrigin(request); return adminJson(await decideWithdrawal(principal.id, (await context.params).id, await request.json()));
});

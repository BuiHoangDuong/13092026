import { resumeSync } from "@cashback/core";
import { adminJson, withAdminMutation } from "@/lib/admin-api";

export const POST = (request: Request, context: { params: Promise<{ exchangeId: string }> }) => withAdminMutation(request, async (principal) => {
  const { exchangeId } = await context.params;
  return adminJson(await resumeSync(principal.id, exchangeId));
});

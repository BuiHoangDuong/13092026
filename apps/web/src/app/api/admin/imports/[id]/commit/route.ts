import { commitImportBatch } from "@cashback/core";
import { adminJson, withAdminMutation } from "@/lib/admin-api";

export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdminMutation(request, async () => {
  const { id } = await context.params;
  return adminJson(await commitImportBatch(id), { status: 202 });
});

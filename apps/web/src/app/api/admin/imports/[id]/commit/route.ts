import { commitImportBatch } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

export const POST = (_request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const { id } = await context.params;
  return adminJson(await commitImportBatch(id), { status: 202 });
});

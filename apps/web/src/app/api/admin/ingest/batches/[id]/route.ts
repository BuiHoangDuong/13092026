import { getImportPreview } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const { id } = await context.params;
  return adminJson(await getImportPreview(id));
});

import { getExecution } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
export const GET = (_request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const execution = await getExecution((await context.params).id);
  return execution ? adminJson(execution) : adminJson({ error: { code: "EXECUTION_NOT_FOUND", message: "Payout execution not found" } }, { status: 404 });
});

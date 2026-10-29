import { payableCommandSchema } from "@cashback/contracts";
import { submitPayableCommand } from "@cashback/core";
import { adminJson, parseAdminRequest, withAdminMutation } from "@/lib/admin-api";
// 202 + commandId only: the worker decides, and only a committed worker result counts as approved or PAID (Req 22.19).
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdminMutation(request, async principal => {
  const input = await parseAdminRequest(request, payableCommandSchema);
  const accepted = await submitPayableCommand(principal.id, { ...input, executionId: (await context.params).id });
  return adminJson(accepted, { status: 202 });
});

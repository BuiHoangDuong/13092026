import { uidApprovalSchema } from "@cashback/contracts";
import { auth, approveUidOwnership } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
import { sessionToken } from "@/lib/auth";
export const POST = (request: Request, context: { params: Promise<{ id: string }> }) => withAdmin(async () => {
  const principal = await auth.requireAdmin(await sessionToken());
  const { id } = await context.params;
  const { note } = uidApprovalSchema.parse(await request.json());
  return adminJson(await approveUidOwnership(id, principal.id, note));
});

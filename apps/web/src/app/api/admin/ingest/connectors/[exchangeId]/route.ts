import { getSyncConfig, updateSyncConfig } from "@cashback/core";
import { adminJson, parseAdminRequest, withAdmin, withAdminMutation } from "@/lib/admin-api";
import { z } from "zod";

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMinutes: z.union([z.literal(30), z.literal(60), z.literal(720), z.literal(1440)]).optional()
});

export const GET = (_request: Request, context: { params: Promise<{ exchangeId: string }> }) => withAdmin(async () => {
  const { exchangeId } = await context.params;
  return adminJson(await getSyncConfig(exchangeId));
});

export const PATCH = (request: Request, context: { params: Promise<{ exchangeId: string }> }) => withAdminMutation(request, async (principal) => {
  const { exchangeId } = await context.params;
  const patch = await parseAdminRequest(request, patchSchema);
  return adminJson(await updateSyncConfig(principal.id, exchangeId, patch));
});

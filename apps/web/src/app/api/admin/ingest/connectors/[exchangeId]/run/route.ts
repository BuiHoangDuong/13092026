import { openWindow, requestSync } from "@cashback/core";
import { adminJson, withAdminMutation } from "@/lib/admin-api";
import { z } from "zod";

const bodySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional()
}).refine((body) => Boolean(body.from) === Boolean(body.to), { message: "Provide both from and to, or neither" })
  .refine((body) => !body.from || !body.to || body.from <= body.to, { message: "from must not be after to" })
  .refine((body) => !body.to || body.to <= new Date().toISOString().slice(0, 10), { message: "to must not be in the future (UTC)" });

function datesBetween(from: string, to: string) {
  const dates: string[] = [];
  for (let cursor = from; cursor <= to && dates.length <= 366; cursor = new Date(Date.parse(`${cursor}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)) dates.push(cursor);
  return dates;
}

export const POST = (request: Request, context: { params: Promise<{ exchangeId: string }> }) => withAdminMutation(request, async (principal) => {
  const { exchangeId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.parse(body);
  const dates = parsed.from && parsed.to ? datesBetween(parsed.from, parsed.to) : openWindow();
  const trigger = parsed.from && parsed.to ? "RESYNC" : "MANUAL";
  return adminJson(await requestSync(principal.id, exchangeId, trigger, dates), { status: 202 });
});

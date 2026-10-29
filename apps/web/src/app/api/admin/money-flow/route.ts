import { moneyFlowModeSchema } from "@cashback/contracts";
import { setMoneyFlowMode } from "@cashback/core";
import { db } from "@cashback/db";
import { adminJson, parseAdminRequest, withAdmin, withAdminMutation } from "@/lib/admin-api";
export const GET = () => withAdmin(async () => { const gate = await db.moneyFlowGate.findUnique({ where: { id: 1 } }); return adminJson({ mode: gate?.mode ?? null, version: gate?.version ?? null }); });
export const POST = (request: Request) => withAdminMutation(request, async principal => adminJson(await setMoneyFlowMode(principal.id, (await parseAdminRequest(request, moneyFlowModeSchema)).mode)));

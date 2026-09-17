import { adminExchangeCreateSchema, adminExchangeUpdateSchema } from "@cashback/contracts";
import { createExchange, listAdminExchanges, updateExchange } from "@cashback/core";
import { adminJson, adminListOptions, parseAdminRequest, withAdmin, withAdminMutation } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => { const page = await listAdminExchanges(adminListOptions(request)); return adminJson({ exchanges: page.items, nextCursor: page.nextCursor }); });
export const POST = (request: Request) => withAdminMutation(request, async () => adminJson({ exchange: await createExchange(await parseAdminRequest(request, adminExchangeCreateSchema)) }, { status: 201 }));
export const PATCH = (request: Request) => withAdminMutation(request, async () => adminJson({ exchange: await updateExchange(await parseAdminRequest(request, adminExchangeUpdateSchema)) }));

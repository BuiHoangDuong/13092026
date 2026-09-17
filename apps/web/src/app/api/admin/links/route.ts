import { adminLinkCreateSchema, adminLinkUpdateSchema } from "@cashback/contracts";
import { createReferralLink, listAdminLinks, updateReferralLink } from "@cashback/core";
import { adminJson, adminListOptions, parseAdminRequest, withAdmin, withAdminMutation } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => { const page = await listAdminLinks(adminListOptions(request)); return adminJson({ links: page.items, nextCursor: page.nextCursor }); });
export const POST = (request: Request) => withAdminMutation(request, async () => adminJson({ link: await createReferralLink(await parseAdminRequest(request, adminLinkCreateSchema)) }, { status: 201 }));
export const PATCH = (request: Request) => withAdminMutation(request, async () => adminJson({ link: await updateReferralLink(await parseAdminRequest(request, adminLinkUpdateSchema)) }));

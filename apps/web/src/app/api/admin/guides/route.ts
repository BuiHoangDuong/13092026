import { adminGuideCreateSchema, adminGuideUpdateSchema } from "@cashback/contracts";
import { createGuide, listAdminGuides, updateGuide } from "@cashback/core";
import { adminJson, adminListOptions, parseAdminRequest, withAdmin, withAdminMutation } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => { const page = await listAdminGuides(adminListOptions(request)); return adminJson({ guides: page.items, nextCursor: page.nextCursor }); });
export const POST = (request: Request) => withAdminMutation(request, async () => adminJson({ guide: await createGuide(await parseAdminRequest(request, adminGuideCreateSchema)) }, { status: 201 }));
export const PATCH = (request: Request) => withAdminMutation(request, async () => adminJson({ guide: await updateGuide(await parseAdminRequest(request, adminGuideUpdateSchema)) }));

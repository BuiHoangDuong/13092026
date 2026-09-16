import { adminOfferCreateSchema, adminOfferUpdateSchema } from "@cashback/contracts";
import { createOffer, listAdminOffers, updateOffer } from "@cashback/core";
import { adminJson, adminListOptions, parseAdminRequest, withAdmin } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => { const page = await listAdminOffers(adminListOptions(request)); return adminJson({ offers: page.items, nextCursor: page.nextCursor }); });
export const POST = (request: Request) => withAdmin(async () => adminJson({ offer: await createOffer(await parseAdminRequest(request, adminOfferCreateSchema)) }, { status: 201 }));
export const PATCH = (request: Request) => withAdmin(async () => adminJson({ offer: await updateOffer(await parseAdminRequest(request, adminOfferUpdateSchema)) }));

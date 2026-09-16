import { uidLinkCreateSchema } from "@cashback/contracts";
import { createUidLink, listUidLinks } from "@cashback/core";
import { customerJson, withCustomer } from "@/lib/customer-api";

export const GET = (request: Request) => withCustomer(request, async id => customerJson(await listUidLinks(id)));
export const POST = (request: Request) => withCustomer(request, async id => {
  const input = uidLinkCreateSchema.parse(await request.json());
  return customerJson(await createUidLink(id, input), 201);
});

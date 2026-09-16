import { getWallet } from "@cashback/core";
import { customerJson, withCustomer } from "@/lib/customer-api";

export const GET = (request: Request) => withCustomer(request, async id => {
  const cursor = new URL(request.url).searchParams.get("cursor") ?? undefined;
  return customerJson(await getWallet(id, cursor));
});

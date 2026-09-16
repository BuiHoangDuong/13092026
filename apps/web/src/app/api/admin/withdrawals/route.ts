import { listWithdrawals } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
export const GET = (request: Request) => withAdmin(async () => adminJson(await listWithdrawals(undefined, new URL(request.url).searchParams.get("cursor") ?? undefined)));

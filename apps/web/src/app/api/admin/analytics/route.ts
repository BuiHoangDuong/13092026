import { getAdminAnalytics } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

export const GET = (request: Request) => withAdmin(async () => {
  const raw = Number(new URL(request.url).searchParams.get("days") ?? 30);
  const days = Number.isFinite(raw) ? raw : 30;
  return adminJson(await getAdminAnalytics(days));
});

import { getAdminSyncStatus } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";

export const GET = () => withAdmin(async () => adminJson(await getAdminSyncStatus()));

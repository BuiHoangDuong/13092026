import { listPendingUidLinks } from "@cashback/core";
import { adminJson, withAdmin } from "@/lib/admin-api";
export const GET = () => withAdmin(async () => adminJson({ links: await listPendingUidLinks() }));

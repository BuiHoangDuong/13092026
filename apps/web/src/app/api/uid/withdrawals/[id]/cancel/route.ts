import { privateJson } from "@/lib/public-access-api";
export async function POST() {
  return privateJson({ error: { code: "CUSTOMER_WITHDRAWALS_RETIRED", message: "Cashback is paid on a schedule to your exchange UID." } }, { status: 410 });
}

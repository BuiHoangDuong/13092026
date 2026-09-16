import { cookies } from "next/headers";
import { listPublishedExchanges, requireUidSession, payoutRoutes } from "@cashback/core";
import { uidCookieName } from "@/lib/uid-api";
import { WithdrawalFlow } from "./withdrawal-flow";
export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ exchangeId?: string; uid?: string }> }) {
  const query = await searchParams; let principal = null;
  try { principal = await requireUidSession((await cookies()).get(uidCookieName)?.value); } catch { /* Start email verification. */ }
  if (principal && ((query.exchangeId && query.exchangeId !== principal.exchangeId) || (query.uid && query.uid !== principal.uid))) principal = null;
  let exchanges: Array<{ id: string; name: string }> = []; let routes = {};
  try { exchanges = (await listPublishedExchanges()).map(x => ({ id: x.id, name: x.name })); routes = payoutRoutes(); } catch { /* Unavailable state is shown by the form. */ }
  return <main className="mx-auto max-w-5xl px-6 py-12"><WithdrawalFlow exchanges={exchanges} routes={routes} initial={principal} exchangeId={query.exchangeId ?? ""} uid={query.uid ?? ""}/></main>;
}

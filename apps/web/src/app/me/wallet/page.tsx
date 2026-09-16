import { auth } from "@cashback/core";
import { redirect } from "next/navigation";
import { sessionToken } from "@/lib/auth";
import { CashbackPanel } from "@/components/cashback-panel";
import { defaultLocale } from "@/i18n";

export const dynamic = "force-dynamic";
export default async function WalletPage() {
  const principal = await auth.getSession(await sessionToken());
  if (!principal || principal.type !== "CUSTOMER") redirect("/login");
  return <main className="mx-auto max-w-6xl px-6 py-10"><h1 className="sr-only">Customer wallet</h1><CashbackPanel locale={defaultLocale} detailed /></main>;
}

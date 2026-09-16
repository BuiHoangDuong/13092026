import { auth } from "@cashback/core";
import { redirect } from "next/navigation";
import { sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";
export default async function WalletPage() {
  const principal = await auth.getSession(await sessionToken());
  if (!principal || principal.type !== "CUSTOMER") redirect("/login");
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">Customer wallet</p>
      <h1 className="text-4xl font-bold tracking-tight text-foreground">Your cashback.</h1>
      <p className="mt-6 rounded-xl border border-dashed border-border bg-muted/40 p-8 text-muted-foreground">
        Wallet balances will appear after a published affiliate report is attributed to your verified UID.
      </p>
    </main>
  );
}

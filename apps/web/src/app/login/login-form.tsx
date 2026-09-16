"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const router = useRouter();
  const [register, setRegister] = useState(false);
  const [role, setRole] = useState("CUSTOMER");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/${register ? "register" : "login"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password, role }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Sign in failed");
      router.replace(!register && role === "ADMIN" ? "/admin" : "/"); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Please try again"); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mt-8 max-w-md space-y-5 rounded-xl border border-border bg-card p-6">
    <div className="flex gap-2"><Button type="button" variant={!register ? "default" : "secondary"} onClick={() => { setRegister(false); setError(""); }}>Sign in</Button><Button type="button" variant={register ? "default" : "secondary"} onClick={() => { setRegister(true); setRole("CUSTOMER"); setError(""); }}>Create account</Button></div>
    <div><label htmlFor="email" className="mb-2 block text-sm">Email</label><Input id="email" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required /></div>
    <div><label htmlFor="password" className="mb-2 block text-sm">Password</label><Input id="password" type="password" autoComplete={register ? "new-password" : "current-password"} minLength={register ? 10 : 1} maxLength={200} value={password} onChange={e => setPassword(e.target.value)} required /></div>
    {!register && <div><label htmlFor="role" className="mb-2 block text-sm">Account type</label><select id="role" value={role} onChange={e => setRole(e.target.value)} className="w-full rounded-md border border-border bg-background p-2"><option value="CUSTOMER">Customer</option><option value="ADMIN">Admin</option></select></div>}
    {register && <p className="text-xs text-muted-foreground">Use at least 10 characters. This creates your Cashback Hub account; your Bybit account is separate.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={busy} className="w-full">{busy ? "Please wait…" : register ? "Create account" : "Sign in"}</Button>
  </form>;
}

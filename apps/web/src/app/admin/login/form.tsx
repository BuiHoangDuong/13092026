"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function AdminLoginForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [busy,setBusy]=useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); const data=new FormData(e.currentTarget);
    try { const r=await fetch("/api/admin/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email:data.get("email"),password:data.get("password")})}); if(!r.ok) throw new Error("Sign in failed"); router.replace("/admin"); router.refresh(); }
    catch(e){setError(e instanceof Error?e.message:"Sign in failed");} finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="mt-6 space-y-4"><label className="block">Email<Input type="email" name="email" autoComplete="email" required /></label><label className="block">Password<Input type="password" name="password" autoComplete="current-password" required maxLength={200}/></label>{error&&<p role="alert">{error}</p>}<Button disabled={busy}>Sign in</Button></form>;
}

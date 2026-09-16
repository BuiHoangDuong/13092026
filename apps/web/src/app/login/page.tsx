import { LoginForm } from "./login-form";
export default function LoginPage() {
  return <main className="mx-auto max-w-3xl px-6 py-16"><p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">Account access</p><h1 className="text-4xl font-bold tracking-tight">Check your cashback.</h1><p className="mt-4 text-muted-foreground">Sign in or create your account to link your Bybit UID.</p><LoginForm /></main>;
}

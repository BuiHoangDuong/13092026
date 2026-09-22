import { requireAdminPage } from "@/lib/require-admin-page";

/** Page-slot auth. A layout redirect does not stop this component from running. */
export async function AdminPage({ title, eyebrow, description, children }: { title: string; eyebrow?: string; description: string; children: React.ReactNode }) {
  await requireAdminPage();
  return (
    <main>
      {eyebrow && <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-primary">{eyebrow}</p>}
      <h1 className="text-4xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{description}</p>
      {children}
    </main>
  );
}

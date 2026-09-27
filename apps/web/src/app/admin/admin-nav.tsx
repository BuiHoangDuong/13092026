"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups = [
  { label: null, items: [{ href: "/admin", label: "Overview", exact: true }] },
  { label: "Data ingest", items: [
    { href: "/admin/ingest/uploads", label: "Uploads" },
    { href: "/admin/ingest/connectors", label: "API connectors" }
  ] },
  { label: "Reports", items: [{ href: "/admin/reports/activity", label: "Referral activity" }] },
  { label: null, items: [
    { href: "/admin/withdrawals", label: "Withdrawals" },
    { href: "/admin/exchanges", label: "Exchanges" },
    { href: "/admin/offers", label: "Offers" },
    { href: "/admin/links", label: "Referral links" },
    { href: "/admin/guides", label: "Guides" }
  ] }
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      <p className="admin-nav-title">Operations</p>
      {groups.map((group) => (
        <div key={group.label ?? "primary"}>
          {group.label && <p className="admin-nav-group">{group.label}</p>}
          {group.items.map((item) => {
            const current = "exact" in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>{item.label}</Link>;
          })}
        </div>
      ))}
    </nav>
  );
}

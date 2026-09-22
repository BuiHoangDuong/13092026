"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/admin", label: "Overview", exact: true },
  { href: "/admin/imports", label: "Bybit imports" },
  { href: "/admin/withdrawals", label: "Withdrawals" },
  { href: "/admin/exchanges", label: "Exchanges" },
  { href: "/admin/offers", label: "Offers" },
  { href: "/admin/links", label: "Referral links" },
  { href: "/admin/guides", label: "Guides" }
] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      <p className="admin-nav-title">Operations</p>
      {items.map((item) => {
        const current = "exact" in item && item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>{item.label}</Link>;
      })}
    </nav>
  );
}

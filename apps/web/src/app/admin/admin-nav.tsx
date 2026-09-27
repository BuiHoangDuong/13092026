"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

const overview = { href: "/admin", label: "Overview" };
const groups = [
  {
    label: "Data ingest",
    path: "/admin/ingest",
    items: [
      { href: "/admin/ingest/uploads", label: "Uploads" },
      { href: "/admin/ingest/connectors", label: "API connectors" }
    ]
  },
  {
    label: "Reports",
    path: "/admin/reports",
    items: [{ href: "/admin/reports/activity", label: "Referral activity" }]
  }
] as const;
const otherPages = [
  { href: "/admin/withdrawals", label: "Withdrawals" },
  { href: "/admin/exchanges", label: "Exchanges" },
  { href: "/admin/offers", label: "Offers" },
  { href: "/admin/links", label: "Referral links" },
  { href: "/admin/guides", label: "Guides" }
] as const;

function NavLink({ href, label, pathname }: { href: string; label: string; pathname: string }) {
  const current = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
  return <Link href={href} aria-current={current ? "page" : undefined}>{label}</Link>;
}

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav" aria-label="Admin">
      <p className="admin-nav-title">Operations</p>
      <NavLink {...overview} pathname={pathname} />
      {groups.map((group) => (
        <details
          className="admin-nav-disclosure"
          key={`${group.path}:${pathname}`}
          open={pathname === group.path || pathname.startsWith(`${group.path}/`) ? true : undefined}
        >
          <summary className="admin-nav-summary">
            {group.label}
            <ChevronDown className="admin-nav-chevron" aria-hidden="true" size={16} />
          </summary>
          <div className="admin-nav-children">
            {group.items.map((item) => <NavLink key={item.href} {...item} pathname={pathname} />)}
          </div>
        </details>
      ))}
      <div className="admin-nav-section">
        {otherPages.map((item) => <NavLink key={item.href} {...item} pathname={pathname} />)}
      </div>
    </nav>
  );
}

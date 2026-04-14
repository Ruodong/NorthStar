"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/graph", label: "Graph" },
  { href: "/standards", label: "Standards" },
  { href: "/whats-new", label: "What\u2019s New" },
  { href: "/ingestion", label: "Ingestion" },
  { href: "/admin", label: "Reference Data" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav>
      {LINKS.map(({ href, label }) => {
        const isActive =
          pathname === href || pathname.startsWith(href + "/");
        return (
          <Link
            key={href}
            href={href}
            className={isActive ? "active" : undefined}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

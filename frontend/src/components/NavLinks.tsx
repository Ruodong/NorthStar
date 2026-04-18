"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ── Grouped navigation: Reference │ Analysis │ Admin ── */
const NAV_GROUPS = [
  /* Reference — primary data entry points */
  [
    { href: "/applications", label: "Applications" },
    { href: "/projects", label: "Projects" },
    { href: "/standards", label: "Standards" },
  ],
  /* Analysis — graph + change tracking */
  [
    { href: "/graph", label: "Graph" },
    { href: "/whats-new", label: "What\u2019s New" },
  ],
  /* Admin — ingestion + raw data */
  [
    { href: "/admin", label: "Admin" },
    { href: "/settings", label: "Settings" },
  ],
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav>
      {NAV_GROUPS.map((group, gi) => (
        <span key={gi} style={{ display: "contents" }}>
          {gi > 0 && (
            <span
              aria-hidden="true"
              style={{
                display: "inline-block",
                width: 1,
                height: 16,
                background: "var(--border-strong)",
                margin: "0 6px",
                verticalAlign: "middle",
                flexShrink: 0,
              }}
            />
          )}
          {group.map(({ href, label }) => {
            const isActive =
              pathname === href ||
              pathname.startsWith(href + "/") ||
              /* /apps/[id] highlights Applications nav */
              (href === "/applications" && pathname.startsWith("/apps/"));
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
        </span>
      ))}
    </nav>
  );
}

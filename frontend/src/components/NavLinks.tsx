"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/* ── Grouped navigation: Main │ Analysis │ Reference ── */
const NAV_GROUPS = [
  /* Main — primary data entry points */
  [
    { href: "/applications", label: "Applications" },
    { href: "/projects", label: "Projects" },
    { href: "/capabilities", label: "Business" },
    { href: "/standards", label: "Standards" },
  ],
  /* Analysis — graph + design */
  [
    { href: "/graph", label: "Graph" },
    { href: "/design", label: "Design" },
  ],
  /* Reference — raw data + settings */
  [
    { href: "/admin", label: "Reference" },
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

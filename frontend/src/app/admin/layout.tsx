"use client";

import Link from "next/link";
import { ReactNode, useEffect, useState } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<{ apps: number | null; projects: number | null }>({
    apps: null,
    projects: null,
  });

  useEffect(() => {
    (async () => {
      try {
        // Apps count: use the same source as /admin/applications (TCO-driven)
        const [appsRes, projRes] = await Promise.all([
          fetch("/api/masters/applications?limit=1", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/masters/projects?limit=1", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setCounts({
          apps: appsRes?.data?.total ?? null,
          projects: projRes?.data?.total ?? null,
        });
      } catch {
        // non-blocking
      }
    })();
  }, []);

  return (
    <div>
      <div
        style={{
          marginBottom: 24,
          paddingBottom: 16,
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--accent)",
            marginBottom: 8,
          }}
        >
          Admin — Raw Data
        </div>
        <nav
          style={{
            display: "flex",
            gap: 4,
            fontSize: 13,
            flexWrap: "wrap",
          }}
        >
          <AdminLink href="/admin">Overview</AdminLink>
          <AdminLink href="/admin/applications">
            Applications <Tag>{fmt(counts.apps)}</Tag>
          </AdminLink>
          <AdminLink href="/admin/projects">
            Projects <Tag>{fmt(counts.projects)}</Tag>
          </AdminLink>
          <AdminLink href="/admin/confluence">Confluence Raw</AdminLink>
          <AdminLink href="/admin/aliases">App Aliases</AdminLink>
        </nav>
      </div>
      {children}
    </div>
  );
}

function fmt(n: number | null): string {
  if (n == null) return "…";
  return n.toLocaleString();
}

function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        color: "var(--text-muted)",
        padding: "8px 14px",
        borderRadius: "var(--radius-md)",
        fontWeight: 500,
      }}
    >
      {children}
    </Link>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-dim)",
        marginLeft: 6,
      }}
    >
      {children}
    </span>
  );
}

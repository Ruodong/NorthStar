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
            marginBottom: 12,
          }}
        >
          Reference Data
        </div>

        {/* Overview link — standalone above the grouped sections */}
        <div style={{ marginBottom: 12 }}>
          <NavLink href="/admin">Overview</NavLink>
        </div>

        {/* Three-column grouped sections */}
        <div
          style={{
            display: "flex",
            gap: 32,
            flexWrap: "wrap",
          }}
        >
          {/* Confluence for ARD */}
          <div>
            <SectionLabel>Confluence for ARD</SectionLabel>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <NavLink href="/admin/confluence">Confluence Raw Data</NavLink>
            </div>
          </div>

          {/* CMDB */}
          <div>
            <SectionLabel>CMDB</SectionLabel>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <NavLink href="/admin/applications">
                Applications <Tag>{fmt(counts.apps)}</Tag>
              </NavLink>
              <NavLink href="/admin/aliases">App Aliases</NavLink>
            </div>
          </div>

          {/* Project Information */}
          <div>
            <SectionLabel>Project Information</SectionLabel>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <NavLink href="/admin/projects">
                Projects <Tag>{fmt(counts.projects)}</Tag>
              </NavLink>
            </div>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

function fmt(n: number | null): string {
  if (n == null) return "…";
  return n.toLocaleString();
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        color: "var(--text-dim)",
      }}
    >
      {children}
    </div>
  );
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        color: "var(--text-muted)",
        padding: "6px 12px",
        borderRadius: "var(--radius-md)",
        fontWeight: 500,
        fontSize: 13,
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

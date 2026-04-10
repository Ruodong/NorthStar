import Link from "next/link";
import { ReactNode } from "react";

export default function AdminLayout({ children }: { children: ReactNode }) {
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
            Applications <Tag>3,168</Tag>
          </AdminLink>
          <AdminLink href="/admin/projects">
            Projects <Tag>2,356</Tag>
          </AdminLink>
          <AdminLink href="/admin/confluence">Confluence Raw</AdminLink>
        </nav>
      </div>
      {children}
    </div>
  );
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

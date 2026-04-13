// HierarchyView.tsx — parent breadcrumb, current node, children tree
// Split from page.tsx for maintainability.

"use client";

import Link from "next/link";
import type { ParentPage, ChildPage } from "../types";

export function HierarchyView({
  currentTitle,
  currentDepth,
  parent,
  children,
}: {
  currentTitle: string;
  currentDepth: number | null;
  parent: ParentPage | null;
  children: ChildPage[];
}) {
  return (
    <div className="panel" style={{ padding: 24 }}>
      <div className="panel-title" style={{ marginBottom: 16 }}>
        Page Hierarchy
      </div>

      {/* Parent breadcrumb */}
      {parent && (
        <div style={{ marginBottom: 10, fontSize: 13 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Parent
          </div>
          <Link
            href={`/admin/confluence/${parent.page_id}`}
            style={{
              color: "var(--accent)",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              d={parent.depth}
            </span>
            {parent.title}
            <span style={{ color: "var(--text-dim)" }}>↗</span>
          </Link>
        </div>
      )}

      {/* Current node */}
      <div
        style={{
          padding: "10px 14px",
          marginTop: parent ? 8 : 0,
          marginBottom: 16,
          background: "var(--surface-hover)",
          borderLeft: "2px solid var(--accent)",
          borderRadius: "var(--radius-md)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--accent)",
            marginBottom: 4,
          }}
        >
          This page
        </div>
        <div style={{ fontSize: 14, color: "var(--text)" }}>
          <span
            style={{
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginRight: 10,
            }}
          >
            d={currentDepth ?? "?"}
          </span>
          {currentTitle}
        </div>
      </div>

      {/* Children */}
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 8,
        }}
      >
        Children ({children.length})
      </div>
      {children.length === 0 ? (
        <div className="empty" style={{ padding: "12px 0" }}>
          No child pages under this node.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {children.map((c) => (
            <Link
              key={c.page_id}
              href={`/admin/confluence/${c.page_id}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 14px",
                borderBottom: "1px solid var(--border)",
                color: "var(--text)",
                textDecoration: "none",
                fontSize: 13,
                borderLeft: "2px solid transparent",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--surface-hover)";
                e.currentTarget.style.borderLeftColor = "var(--border-strong)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderLeftColor = "transparent";
              }}
            >
              <span
                style={{
                  color: "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  width: 24,
                  flexShrink: 0,
                }}
              >
                d={c.depth}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                {c.title}
              </span>
              <CountChip
                label="att"
                value={c.own_attachments}
                color="var(--text-muted)"
              />
              <CountChip
                label="drawio"
                value={c.own_drawio + c.ref_drawio}
                color={
                  c.own_drawio + c.ref_drawio > 0 ? "var(--accent)" : "var(--text-dim)"
                }
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function CountChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "2px 8px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        minWidth: 60,
        justifyContent: "flex-end",
      }}
    >
      <span>{value}</span>
      <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span>
    </span>
  );
}

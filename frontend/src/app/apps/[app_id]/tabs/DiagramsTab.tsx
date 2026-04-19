"use client";

import { useState } from "react";
import Link from "next/link";
import type { DiagramRef } from "../_shared/types";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";

export function DiagramsTab({ diagrams }: { diagrams: DiagramRef[] }) {
  const [view, setView] = useState<"grid" | "list">("grid");
  if (diagrams.length === 0) {
    return (
      <Panel title="Diagrams describing this app">
        <EmptyState>No diagrams found for this application.</EmptyState>
      </Panel>
    );
  }
  const hasAnyThumbnail = diagrams.some((d) => d.attachment_id);
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        overflow: "hidden",
      }}
    >
      {/* Header with view toggle */}
      <div
        style={{
          padding: "14px 20px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="panel-title" style={{ margin: 0 }}>
          Diagrams ({diagrams.length})
        </div>
        {hasAnyThumbnail && (
          <div style={{ display: "flex", gap: 2 }}>
            <button
              onClick={() => setView("grid")}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: view === "grid" ? "var(--accent)" : "transparent",
                color: view === "grid" ? "var(--bg)" : "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm) 0 0 var(--radius-sm)",
                cursor: "pointer",
              }}
            >
              ▦ Grid
            </button>
            <button
              onClick={() => setView("list")}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                background: view === "list" ? "var(--accent)" : "transparent",
                color: view === "list" ? "var(--bg)" : "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
                cursor: "pointer",
              }}
            >
              ☰ List
            </button>
          </div>
        )}
      </div>

      {/* Group diagrams by project */}
      {(() => {
        const groups: { key: string; label: string; items: DiagramRef[] }[] = [];
        const byProject = new Map<string, DiagramRef[]>();
        for (const d of diagrams) {
          const k = d.project_id || "_none";
          if (!byProject.has(k)) byProject.set(k, []);
          byProject.get(k)!.push(d);
        }
        // Named projects first, "Other Diagrams" last
        for (const [k, items] of byProject) {
          if (k === "_none") continue;
          const first = items[0];
          const label = `${first.project_id}${first.project_name ? " — " + first.project_name : ""}`;
          groups.push({ key: k, label, items });
        }
        const noProject = byProject.get("_none");
        if (noProject) {
          groups.push({ key: "_none", label: "Other Diagrams", items: noProject });
        }
        return groups.map((g) => (
          <div key={g.key}>
            {groups.length > 1 && (
              <div
                style={{
                  padding: "10px 20px 6px",
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--accent)",
                  fontFamily: "var(--font-mono)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {g.label}
                <span style={{ color: "var(--text-dim)", fontWeight: 400, marginLeft: 8 }}>
                  ({g.items.length})
                </span>
              </div>
            )}
            {view === "grid" && hasAnyThumbnail ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 1,
                  background: "var(--border)",
                }}
              >
                {g.items.map((d, idx) => (
                  <DiagramCard key={d.diagram_id || d.attachment_id || idx} d={d} />
                ))}
              </div>
            ) : (
              <DiagramList diagrams={g.items} />
            )}
          </div>
        ));
      })()}
    </div>
  );
}

function DiagramCard({ d }: { d: DiagramRef }) {
  const [imgErr, setImgErr] = useState(false);
  const thumbSrc = d.attachment_id
    ? `/api/admin/confluence/attachments/${d.attachment_id}/thumbnail`
    : null;
  const linkTarget = d.page_id ? `/admin/confluence/${d.page_id}` : null;

  const card = (
    <div
      style={{
        background: "var(--surface)",
        padding: 0,
        display: "flex",
        flexDirection: "column",
        cursor: linkTarget ? "pointer" : "default",
        transition: "background var(--t-hover) var(--ease)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-elevated)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface)";
      }}
    >
      {/* Thumbnail area */}
      <div
        style={{
          height: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {thumbSrc && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbSrc}
            alt={d.file_name || "diagram"}
            loading="lazy"
            onError={() => setImgErr(true)}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        ) : (
          <span
            style={{
              fontSize: 10,
              fontFamily: "var(--font-mono)",
              color: "var(--text-dim)",
              textTransform: "uppercase",
              letterSpacing: 1,
            }}
          >
            {d.diagram_type || d.file_kind || "DRAWIO"}
          </span>
        )}
      </div>

      {/* Info area */}
      <div style={{ padding: "10px 14px" }}>
        <div
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={d.file_name || ""}
        >
          {d.file_name || "(unnamed)"}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 6,
            alignItems: "center",
          }}
        >
          {d.fiscal_year && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                color: "var(--accent)",
                fontFamily: "var(--font-mono)",
                background: "rgba(246,166,35,0.08)",
                borderRadius: "var(--radius-sm)",
              }}
            >
              {d.fiscal_year}
            </span>
          )}
          <span
            style={{
              fontSize: 10,
              padding: "1px 6px",
              background: "var(--bg-elevated)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
              textTransform: "uppercase",
            }}
          >
            {d.diagram_type || d.file_kind || "drawio"}
          </span>
        </div>
        {d.page_title && (
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              marginTop: 6,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={d.page_title}
          >
            {d.page_title}
          </div>
        )}
      </div>
    </div>
  );

  if (linkTarget) {
    return (
      <Link href={linkTarget} style={{ textDecoration: "none", color: "inherit" }}>
        {card}
      </Link>
    );
  }
  return card;
}

function DiagramList({ diagrams }: { diagrams: DiagramRef[] }) {
  return (
    <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
      {diagrams.map((d, idx) => (
        <li
          key={d.diagram_id || d.attachment_id || idx}
          style={{
            padding: "10px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            gap: 14,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span style={{
            fontSize: 10, padding: "2px 8px",
            background: "var(--bg-elevated)", border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)", color: "var(--text-muted)",
            fontFamily: "var(--font-mono)", textTransform: "uppercase",
          }}>
            {d.diagram_type || d.file_kind || "drawio"}
          </span>
          {d.fiscal_year && (
            <span style={{ fontSize: 10, padding: "2px 8px", color: "var(--accent)", fontFamily: "var(--font-mono)" }}>
              {d.fiscal_year}
            </span>
          )}
          {d.page_id ? (
            <Link
              href={`/admin/confluence/${d.page_id}`}
              style={{ flex: 1, fontSize: 13, color: "var(--text)" }}
              title={d.page_title || ""}
            >
              {d.file_name || "(unnamed)"}
            </Link>
          ) : (
            <span style={{ flex: 1, fontSize: 13 }}>{d.file_name || "(unnamed)"}</span>
          )}
          {d.page_title && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{d.page_title}</span>
          )}
          {d.source_systems && d.source_systems.length > 0 && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {d.source_systems.join("+")}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}


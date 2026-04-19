"use client";

import Link from "next/link";
import type { Investment } from "../_shared/types";
import { STATUS_COLORS } from "../_shared/types";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";

export function InvestmentsTab({ investments }: { investments: Investment[] }) {
  if (investments.length === 0) {
    return (
      <Panel title="Projects that invested in this app">
        <EmptyState>No projects recorded for this application.</EmptyState>
      </Panel>
    );
  }

  // Already sorted by fiscal_year DESC from backend, but re-sort just in case
  const sorted = [...investments].sort((a, b) =>
    (b.fiscal_year || "").localeCompare(a.fiscal_year || ""),
  );

  return (
    <Panel title={`Projects that invested in this app (${investments.length})`}>
      {/* Legend */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 14,
          marginBottom: 10,
        }}
      >
        {(["Change", "New", "Sunset"] as const).map((s) => (
          <span
            key={s}
            style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10 }}
          >
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: STATUS_COLORS[s] || "var(--border)",
                opacity: 0.85,
              }}
            />
            <span
              style={{
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: 0.4,
              }}
            >
              {s}
            </span>
          </span>
        ))}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "var(--text-dim)", textTransform: "uppercase", fontSize: 10 }}>
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                width: 110,
              }}
            >
              Project ID
            </th>
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              Project Name
            </th>
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
              }}
            >
              Major Applications
            </th>
            <th
              style={{
                textAlign: "left",
                padding: "8px 12px",
                borderBottom: "1px solid var(--border)",
                width: 80,
              }}
            >
              FY
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((inv, idx) => (
            <tr key={`${inv.project_id}-${idx}`}>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {inv.project_id ? (
                  <Link
                    href={`/admin/projects/${encodeURIComponent(inv.project_id)}`}
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    {inv.project_id}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                }}
              >
                {inv.root_page_id ? (
                  <Link
                    href={`/admin/confluence/${inv.root_page_id}?tab=extracted`}
                    style={{ color: "var(--accent)", textDecoration: "none" }}
                  >
                    {inv.project_name || inv.project_id}
                  </Link>
                ) : (
                  <span style={{ color: "var(--text-muted)" }}>
                    {inv.project_name || "—"}
                  </span>
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: 11,
                  lineHeight: 1.8,
                }}
              >
                {inv.major_apps && inv.major_apps.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {inv.major_apps.map((ma, mi) => (
                      <Link
                        key={`${ma.app_id}-${mi}`}
                        href={`/apps/${ma.app_id}`}
                        style={{
                          display: "inline-block",
                          padding: "1px 8px",
                          borderRadius: "var(--radius-sm)",
                          border: `1px solid ${
                            STATUS_COLORS[ma.status] || "var(--border)"
                          }`,
                          color: STATUS_COLORS[ma.status] || "var(--text-muted)",
                          textDecoration: "none",
                          fontSize: 10,
                          whiteSpace: "nowrap",
                        }}
                        title={`${ma.app_id} — ${ma.app_name} (${ma.status})`}
                      >
                        {ma.app_name}
                      </Link>
                    ))}
                  </div>
                ) : (
                  <span style={{ color: "var(--text-dim)" }}>—</span>
                )}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                }}
              >
                {inv.fiscal_year || "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

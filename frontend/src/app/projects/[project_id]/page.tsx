"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface ProjectApp {
  app_id: string;
  app_name: string | null;
  role: string | null;
  cmdb_name: string | null;
  cmdb_status: string | null;
  app_ownership: string | null;
  portfolio_mgt: string | null;
  u_service_area: string | null;
}

interface ConfPage {
  page_id: number;
  title: string;
  page_url: string | null;
  fiscal_year: string | null;
  depth: number;
}

interface DiagramRef {
  attachment_id: number;
  file_name: string;
  file_kind: string;
  page_id: string;
  page_title: string;
  fiscal_year: string | null;
  thumbnail_id: number | null;
}

interface ProjectDetail {
  project: Record<string, string | null>;
  applications: ProjectApp[];
  role_summary: Record<string, number>;
  pages: ConfPage[];
  diagrams: DiagramRef[];
}

const ROLE_COLORS: Record<string, string> = {
  New: "#5fc58a",
  Change: "#6ba6e8",
  Sunset: "#e8716b",
  Keep: "#9aa4b8",
  "3rd Party": "#a8b0c0",
};

const STATUS_COLORS: Record<string, string> = {
  Active: "#5fc58a",
  Planned: "#6ba6e8",
  Decommissioned: "#6b7488",
  Retain: "#e8b458",
};

export default function ProjectDetailPage() {
  const params = useParams();
  const project_id = params.project_id as string;
  const [data, setData] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const r = await fetch(`/api/masters/projects/${encodeURIComponent(project_id)}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error || "Not found");
        setData(j.data);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [project_id]);

  if (loading) return <div style={{ padding: 40, color: "var(--text-dim)" }}>Loading\u2026</div>;
  if (err) return <div className="panel" style={{ borderColor: "#5b1f1f", margin: 40 }}>Error: {err}</div>;
  if (!data) return null;

  const { project, applications, role_summary, pages, diagrams } = data;

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <Link href="/projects" style={{ color: "var(--text-dim)", fontSize: 12, textDecoration: "none" }}>
            \u2190 Projects
          </Link>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <code style={{ fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--accent)" }}>
            {project_id}
          </code>
          {project.status && (
            <span className="status-pill" style={{ fontSize: 11, padding: "3px 10px", color: "var(--text-muted)", background: "var(--surface-hover)" }}>
              {project.status}
            </span>
          )}
          {project.source && (
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{project.source}</span>
          )}
        </div>
        <h1 style={{ marginTop: 8, marginBottom: 4 }}>{project.project_name || project_id}</h1>
        <div style={{ display: "flex", gap: 24, fontSize: 12, color: "var(--text-muted)", flexWrap: "wrap" }}>
          {project.pm && <span>PM: <strong>{project.pm}</strong></span>}
          {project.it_lead && <span>IT Lead: <strong>{project.it_lead}</strong></span>}
          {project.dt_lead && <span>DT Lead: <strong>{project.dt_lead}</strong></span>}
          {project.go_live_date && <span>Go-Live: <strong>{project.go_live_date}</strong></span>}
        </div>
      </div>

      {/* ── Impact summary cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 24 }}>
        <SummaryCard label="Total Applications" value={applications.length} />
        <SummaryCard label="New" value={role_summary.New || 0} color={ROLE_COLORS.New} />
        <SummaryCard label="Change" value={role_summary.Change || 0} color={ROLE_COLORS.Change} />
        <SummaryCard label="Sunset" value={role_summary.Sunset || 0} color={ROLE_COLORS.Sunset} />
        <SummaryCard label="Keep" value={role_summary.Keep || 0} />
        <SummaryCard label="Documents" value={pages.length} />
      </div>

      {/* ── Applications table ── */}
      <CollapsibleSection title="Applications" count={applications.length} defaultOpen>
        {applications.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
            No CMDB-linked applications found in this project's diagrams.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>App ID</th>
                <th>Name</th>
                <th style={{ width: 80 }}>Role</th>
                <th style={{ width: 100 }}>CMDB Status</th>
                <th style={{ width: 100 }}>Ownership</th>
                <th style={{ width: 120 }}>Service Area</th>
              </tr>
            </thead>
            <tbody>
              {applications.map((a, i) => (
                <tr key={`${a.app_id}-${i}`}>
                  <td>
                    <Link href={`/apps/${encodeURIComponent(a.app_id)}`} style={{ color: "var(--accent)" }}>
                      <code>{a.app_id}</code>
                    </Link>
                  </td>
                  <td>{a.cmdb_name || a.app_name || "\u2014"}</td>
                  <td>
                    {a.role && (
                      <span className="status-pill" style={{
                        color: ROLE_COLORS[a.role] || "var(--text-muted)",
                        background: `${ROLE_COLORS[a.role] || "#5f6a80"}26`,
                      }}>
                        {a.role}
                      </span>
                    )}
                  </td>
                  <td>
                    {a.cmdb_status ? (
                      <span className="status-pill" style={{
                        color: STATUS_COLORS[a.cmdb_status] || "var(--text-muted)",
                        background: `${STATUS_COLORS[a.cmdb_status] || "#5f6a80"}26`,
                      }}>
                        {a.cmdb_status}
                      </span>
                    ) : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>\u2014</span>}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{a.app_ownership || "\u2014"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>{a.u_service_area || "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CollapsibleSection>

      {/* ── Documents ── */}
      {pages.length > 0 && (
        <CollapsibleSection title="Documents" count={pages.length} defaultOpen>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {pages.map((p) => (
              <div key={p.page_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                {p.fiscal_year && (
                  <span style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-dim)", minWidth: 50 }}>
                    {p.fiscal_year}
                  </span>
                )}
                <Link
                  href={`/admin/confluence/${p.page_id}`}
                  style={{ color: "var(--text)", textDecoration: "none", fontSize: 13, flex: 1 }}
                >
                  {p.title}
                </Link>
                {p.page_url && (
                  <a href={p.page_url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-dim)", fontSize: 10 }}>
                    Confluence {"\u2197"}
                  </a>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* ── Diagrams ── */}
      {diagrams.length > 0 && (
        <CollapsibleSection title="Diagrams" count={diagrams.length}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, padding: 16 }}>
            {diagrams.map((d) => (
              <Link
                key={d.attachment_id}
                href={`/admin/confluence/${d.page_id}?tab=extracted`}
                style={{ textDecoration: "none", color: "inherit" }}
              >
                <div style={{
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  overflow: "hidden",
                  transition: "border-color 0.15s",
                  cursor: "pointer",
                }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                >
                  {/* Thumbnail */}
                  <div style={{
                    height: 160,
                    background: "var(--bg-elevated)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    overflow: "hidden",
                  }}>
                    {d.thumbnail_id ? (
                      <img
                        src={`/api/admin/confluence/attachments/${d.thumbnail_id}/raw`}
                        alt={d.file_name}
                        style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
                        loading="lazy"
                      />
                    ) : (
                      <span style={{ fontSize: 32, color: "var(--text-dim)", opacity: 0.3 }}>
                        .drawio
                      </span>
                    )}
                  </div>
                  {/* Caption */}
                  <div style={{ padding: "8px 10px", borderTop: "1px solid var(--border)" }}>
                    <div style={{
                      fontSize: 11,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                      title={d.file_name}
                    >
                      {d.file_name.replace(/\.drawio(\.xml)?$/, "")}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
                      {d.page_title}
                      {d.fiscal_year && <span style={{ marginLeft: 8, fontFamily: "var(--font-mono)" }}>{d.fiscal_year}</span>}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel" style={{ padding: 0, overflow: "hidden", marginBottom: 24 }}>
      <div
        onClick={() => setOpen(!open)}
        style={{
          padding: "12px 20px",
          borderBottom: open ? "1px solid var(--border)" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 10, color: "var(--text-dim)", width: 12 }}>{open ? "\u25be" : "\u25b8"}</span>
          {title} ({count})
        </h3>
      </div>
      {open && children}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{
      padding: 14,
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-lg)",
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-dim)", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{
        fontFamily: "var(--font-display)",
        fontSize: 28,
        fontWeight: 600,
        fontVariantNumeric: "tabular-nums",
        color: color || "var(--text)",
        lineHeight: 1.1,
      }}>
        {value}
      </div>
    </div>
  );
}

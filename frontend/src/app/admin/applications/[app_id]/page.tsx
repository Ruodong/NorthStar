"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface Cmdb {
  app_id: string;
  name: string;
  app_full_name: string | null;
  short_description: string | null;
  status: string | null;
  u_service_area: string | null;
  app_classification: string | null;
  app_ownership: string | null;
  app_solution_type: string | null;
  portfolio_mgt: string | null;
  owned_by: string | null;
  owned_by_name: string | null;
  app_it_owner: string | null;
  app_it_owner_name: string | null;
  app_dt_owner: string | null;
  app_dt_owner_name: string | null;
  app_operation_owner: string | null;
  app_operation_owner_name: string | null;
  app_owner_tower: string | null;
  app_owner_domain: string | null;
  app_operation_owner_tower: string | null;
  app_operation_owner_domain: string | null;
  patch_level: string | null;
  decommissioned_at: string | null;
  source_system: string | null;
  synced_at: string | null;
}

interface Tco {
  application_classification: string | null;
  stamp_k: number | null;
  budget_k: number | null;
  actual_k: number | null;
  allocation_stamp_k: number | null;
  allocation_actual_k: number | null;
}

interface ConfluencePage {
  page_id: string;
  fiscal_year: string;
  title: string;
  page_url: string;
  body_size_chars: number | null;
  q_pm: string | null;
  q_it_lead: string | null;
  q_dt_lead: string | null;
}

interface Attachment {
  attachment_id: string;
  page_id: string;
  title: string;
  file_kind: string;
  file_size: number | null;
  local_path: string | null;
}

interface GraphProject {
  project_id: string;
  name: string;
  fiscal_year: string | null;
  page_type: string | null;
  pm: string | null;
  it_lead: string | null;
  dt_lead: string | null;
}

interface GraphEdge {
  target_app_id?: string;
  target_name?: string;
  target_status?: string;
  source_app_id?: string;
  source_name?: string;
  source_status?: string;
  interaction_type: string | null;
  business_object: string | null;
  status: string | null;
}

interface Overview {
  app_id: string;
  cmdb: Cmdb;
  tco: Tco | null;
  confluence_pages: ConfluencePage[];
  attachments: Attachment[];
  graph: {
    projects: GraphProject[];
    outbound: GraphEdge[];
    inbound: GraphEdge[];
  };
  egm_diagram_hits: unknown[];
}

const STATUS_COLORS: Record<string, string> = {
  Active: "#5fc58a",
  Planned: "#6ba6e8",
  Decommissioned: "#6b7488",
  Retain: "#e8b458",
};

const PORTFOLIO_COLORS: Record<string, string> = {
  Invest: "#5fc58a",
  Tolerate: "#e8b458",
  Migrate: "#6ba6e8",
  Eliminate: "#e8716b",
};

function formatMoney(k: number | null): string {
  if (k == null) return "—";
  if (Math.abs(k) < 0.01) return "$0";
  if (Math.abs(k) < 1000) return `$${k.toFixed(2)}k`;
  return `$${(k / 1000).toFixed(2)}M`;
}

function humanSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ApplicationOverviewPage() {
  const params = useParams();
  const appId = params.app_id as string;
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/applications/${encodeURIComponent(appId)}/overview`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setData(j.data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [appId]);

  if (err)
    return (
      <div>
        <Link href="/admin/applications" style={{ color: "var(--text-muted)" }}>
          ← All applications
        </Link>
        <div className="panel" style={{ marginTop: 16, borderColor: "#5b1f1f" }}>{err}</div>
      </div>
    );
  if (!data) return <div className="subtitle">Loading…</div>;

  const { cmdb, tco, confluence_pages, attachments, graph } = data;
  const statusColor = STATUS_COLORS[cmdb.status || ""] || "var(--text-muted)";
  const portfolioColor = PORTFOLIO_COLORS[cmdb.portfolio_mgt || ""] || "var(--text-muted)";

  return (
    <div>
      <Link href="/admin/applications" style={{ color: "var(--text-muted)", fontSize: 13 }}>
        ← All applications
      </Link>

      {/* Header */}
      <div style={{ marginTop: 12, marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--accent)",
            marginBottom: 6,
            fontFamily: "var(--font-mono)",
          }}
        >
          {cmdb.app_id}
        </div>
        <h1 style={{ margin: 0, display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
          {cmdb.name}
          {cmdb.app_full_name && cmdb.app_full_name !== cmdb.name && (
            <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: 400 }}>
              {cmdb.app_full_name}
            </span>
          )}
        </h1>
        <div
          style={{
            display: "flex",
            gap: 10,
            marginTop: 12,
            flexWrap: "wrap",
            fontSize: 11,
          }}
        >
          {cmdb.status && <Chip label={cmdb.status} color={statusColor} />}
          {cmdb.portfolio_mgt && <Chip label={cmdb.portfolio_mgt} color={portfolioColor} />}
          {cmdb.app_classification && (
            <Chip label={cleanBraces(cmdb.app_classification)} color="var(--text-muted)" muted />
          )}
          {cmdb.app_solution_type && (
            <Chip label={cmdb.app_solution_type} color="var(--text-muted)" muted />
          )}
          {cmdb.u_service_area && (
            <Chip label={cmdb.u_service_area} color="var(--text-muted)" muted />
          )}
          {cmdb.app_ownership && (
            <Chip label={cmdb.app_ownership} color="var(--text-muted)" muted />
          )}
        </div>
      </div>

      {/* Source badges row */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", fontSize: 11 }}>
        <SourceBadge label="CMDB" active count={1} />
        <SourceBadge label="TCO" active={!!tco} count={tco ? 1 : 0} />
        <SourceBadge
          label="Confluence"
          active={confluence_pages.length > 0}
          count={confluence_pages.length}
        />
        <SourceBadge label="Attachments" active={attachments.length > 0} count={attachments.length} />
        <SourceBadge label="Graph" active={graph.projects.length > 0} count={graph.projects.length} />
        <SourceBadge
          label="Integrations"
          active={graph.outbound.length + graph.inbound.length > 0}
          count={graph.outbound.length + graph.inbound.length}
        />
      </div>

      {/* Ownership + Organization side-by-side */}
      <div className="panel-grid">
        <div className="panel">
          <div className="panel-title">Ownership</div>
          <table>
            <tbody>
              <KVRow
                k="Owned by"
                v={renderPerson(cmdb.owned_by, cmdb.owned_by_name)}
              />
              <KVRow
                k="IT Owner"
                v={renderPerson(cmdb.app_it_owner, cmdb.app_it_owner_name)}
              />
              <KVRow
                k="DT Owner"
                v={renderPerson(cmdb.app_dt_owner, cmdb.app_dt_owner_name)}
              />
              <KVRow
                k="Operation Owner"
                v={renderPerson(
                  cmdb.app_operation_owner,
                  cmdb.app_operation_owner_name
                )}
              />
            </tbody>
          </table>
        </div>

        <div className="panel">
          <div className="panel-title">Organization</div>
          <table>
            <tbody>
              <KVRow k="App Tower" v={cmdb.app_owner_tower} />
              <KVRow k="App Domain" v={cmdb.app_owner_domain} />
              <KVRow k="Ops Tower" v={cmdb.app_operation_owner_tower} />
              <KVRow k="Ops Domain" v={cmdb.app_operation_owner_domain} />
              <KVRow k="Patch Level" v={cmdb.patch_level} />
              <KVRow
                k="Decommissioned"
                v={cmdb.decommissioned_at ? new Date(cmdb.decommissioned_at).toLocaleDateString() : null}
              />
            </tbody>
          </table>
        </div>
      </div>

      {/* Financial (TCO) */}
      {tco && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Financial (TCO)</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 18,
              fontSize: 13,
            }}
          >
            <MoneyCell label="Budget" v={tco.budget_k} />
            <MoneyCell label="Actual" v={tco.actual_k} />
            <MoneyCell label="Stamp" v={tco.stamp_k} />
            <MoneyCell
              label="Variance"
              v={tco.budget_k != null && tco.actual_k != null ? tco.budget_k - tco.actual_k : null}
              signed
            />
            <MoneyCell label="Allocation Stamp" v={tco.allocation_stamp_k} />
            <MoneyCell label="Allocation Actual" v={tco.allocation_actual_k} />
          </div>
        </div>
      )}

      {/* Confluence application page(s) */}
      {confluence_pages.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">
            Confluence Application Pages ({confluence_pages.length})
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 80 }}>FY</th>
                <th>Title</th>
                <th style={{ width: 150 }}>PM</th>
                <th style={{ width: 150 }}>IT Lead</th>
                <th style={{ width: 150 }}>DT Lead</th>
                <th style={{ width: 90 }}></th>
              </tr>
            </thead>
            <tbody>
              {confluence_pages.map((p) => (
                <tr key={p.page_id}>
                  <td>
                    <code>{p.fiscal_year}</code>
                  </td>
                  <td>
                    <Link
                      href={`/admin/confluence/${p.page_id}`}
                      style={{ color: "var(--text)" }}
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.q_pm || "—"}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.q_it_lead || "—"}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.q_dt_lead || "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    <a
                      href={p.page_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 11,
                        color: "var(--text-dim)",
                        fontFamily: "var(--font-mono)",
                      }}
                    >
                      Confluence ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Projects that include this app */}
      {graph.projects.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Appears in Projects ({graph.projects.length})</div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 120 }}>Project ID</th>
                <th>Name</th>
                <th style={{ width: 80 }}>FY</th>
                <th style={{ width: 150 }}>PM</th>
                <th style={{ width: 150 }}>IT Lead</th>
              </tr>
            </thead>
            <tbody>
              {graph.projects.map((p) => (
                <tr key={p.project_id}>
                  <td>
                    <Link
                      href={`/admin/projects/${encodeURIComponent(p.project_id)}`}
                      style={{ color: "var(--accent)" }}
                    >
                      <code>{p.project_id}</code>
                    </Link>
                  </td>
                  <td>{p.name}</td>
                  <td>{p.fiscal_year && <code>{p.fiscal_year}</code>}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.pm || "—"}</td>
                  <td style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.it_lead || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Integrations */}
      {(graph.outbound.length > 0 || graph.inbound.length > 0) && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">
            Integrations ({graph.outbound.length} out / {graph.inbound.length} in)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 8,
                }}
              >
                Outbound — this app calls these
              </div>
              {graph.outbound.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>
                  (none)
                </div>
              ) : (
                <table>
                  <tbody>
                    {graph.outbound.map((e, i) => (
                      <tr key={i}>
                        <td style={{ width: 110 }}>
                          <Link
                            href={`/admin/applications/${encodeURIComponent(e.target_app_id || "")}`}
                            style={{ color: "var(--accent)" }}
                          >
                            <code>{e.target_app_id}</code>
                          </Link>
                        </td>
                        <td>{e.target_name}</td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {e.interaction_type || "—"}
                          {e.business_object && (
                            <span style={{ color: "var(--text-dim)" }}> · {e.business_object}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div>
              <div
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 8,
                }}
              >
                Inbound — these call this app
              </div>
              {graph.inbound.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>
                  (none)
                </div>
              ) : (
                <table>
                  <tbody>
                    {graph.inbound.map((e, i) => (
                      <tr key={i}>
                        <td style={{ width: 110 }}>
                          <Link
                            href={`/admin/applications/${encodeURIComponent(e.source_app_id || "")}`}
                            style={{ color: "var(--accent)" }}
                          >
                            <code>{e.source_app_id}</code>
                          </Link>
                        </td>
                        <td>{e.source_name}</td>
                        <td style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          {e.interaction_type || "—"}
                          {e.business_object && (
                            <span style={{ color: "var(--text-dim)" }}> · {e.business_object}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Attachments ({attachments.length})</div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 100 }}>Kind</th>
                <th>Title</th>
                <th style={{ width: 100, textAlign: "right" }}>Size</th>
                <th style={{ width: 100 }}></th>
              </tr>
            </thead>
            <tbody>
              {attachments.map((a) => (
                <tr key={a.attachment_id}>
                  <td
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10,
                      color: "var(--text-muted)",
                      textTransform: "uppercase",
                    }}
                  >
                    {a.file_kind}
                  </td>
                  <td style={{ wordBreak: "break-all" }}>{a.title}</td>
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    {humanSize(a.file_size)}
                  </td>
                  <td>
                    <Link
                      href={`/admin/confluence/${a.page_id}`}
                      style={{ fontSize: 11, color: "var(--accent)" }}
                    >
                      Preview →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Description */}
      {cmdb.short_description && cmdb.short_description !== "{}" && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Description (from ServiceNow)</div>
          <pre
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--text-muted)",
              whiteSpace: "pre-wrap",
              fontFamily: "var(--font-mono)",
            }}
          >
            {cmdb.short_description}
          </pre>
        </div>
      )}
    </div>
  );
}

function Chip({
  label,
  color,
  muted,
}: {
  label: string;
  color: string;
  muted?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "4px 10px",
        borderRadius: "var(--radius-sm)",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        background: muted ? "var(--surface-hover)" : `${color}22`,
        color,
        border: `1px solid ${color}44`,
      }}
    >
      {label}
    </span>
  );
}

function SourceBadge({
  label,
  active,
  count,
}: {
  label: string;
  active: boolean;
  count: number;
}) {
  return (
    <span
      style={{
        padding: "4px 10px",
        borderRadius: "var(--radius-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        letterSpacing: 0.6,
        background: active ? "rgba(246,166,35,0.12)" : "var(--bg-elevated)",
        color: active ? "var(--accent)" : "var(--text-dim)",
        border: `1px solid ${active ? "rgba(246,166,35,0.3)" : "var(--border)"}`,
      }}
    >
      {label.toUpperCase()} · {count}
    </span>
  );
}

function KVRow({ k, v }: { k: string; v: React.ReactNode | null }) {
  return (
    <tr>
      <th style={{ width: "34%" }}>{k}</th>
      <td style={{ color: v ? "var(--text)" : "var(--text-dim)", fontSize: 13 }}>
        {v || "—"}
      </td>
    </tr>
  );
}

function renderPerson(itcode: string | null, name: string | null): React.ReactNode {
  if (!itcode) return null;
  if (name) {
    return (
      <span>
        {name}{" "}
        <code style={{ color: "var(--text-dim)", fontSize: 11 }}>{itcode}</code>
      </span>
    );
  }
  return <code>{itcode}</code>;
}

function MoneyCell({
  label,
  v,
  signed,
}: {
  label: string;
  v: number | null;
  signed?: boolean;
}) {
  const color =
    signed && v != null
      ? v >= 0
        ? "#5fc58a"
        : "#e8716b"
      : "var(--text)";
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 18,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {v == null ? "—" : (signed && v >= 0 ? "+" : "") + formatMoney(v)}
      </div>
    </div>
  );
}

function cleanBraces(s: string): string {
  // CMDB stores things like {"Business Application"} — strip the outer braces/quotes.
  return s.replace(/^[\{\["']+|[\}\]"']+$/g, "").trim();
}

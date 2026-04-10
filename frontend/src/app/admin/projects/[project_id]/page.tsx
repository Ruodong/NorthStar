"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface MSPO {
  project_id: string;
  project_name: string | null;
  type: string | null;
  status: string | null;
  overall_status: string | null;
  pm: string | null;
  pm_itcode: string | null;
  it_lead: string | null;
  it_lead_itcode: string | null;
  dt_lead: string | null;
  dt_lead_itcode: string | null;
  start_date: string | null;
  go_live_date: string | null;
  end_date: string | null;
  pps_exit_date: string | null;
  duration: number | null;
  objectives: string | null;
  investment_cost: number | null;
  yearly_ma_cost: number | null;
  currency: string | null;
  expected_man_days: number | null;
  comment: string | null;
  ea_review_type: string | null;
  domain_ea_reviewer: string | null;
  ea_approval_dt: string | null;
  approved_time: string | null;
  ai_related: string | null;
  source: string | null;
}

interface ProjectSummary {
  business_owner1: string | null;
  business_owner2: string | null;
  cost: string | null;
  schedule: string | null;
  function_summary: string | null;
  benefit: string | null;
  paint_point: string | null;
  application_list: string[] | null;
  architect_summary: string | null;
  ea_status: string | null;
  status_remark: string | null;
  attachments: string[] | null;
  ea_review_submitter: string | null;
  comments_app: string | null;
  ea_review_type: string | null;
  domain_ea_reviewer: string | null;
}

interface TeamMember {
  itcode: string;
  name: string | null;
  worker_type: string | null;
  manager_itcode: string | null;
  tier_1_org: string | null;
  tier_2_org: string | null;
  job_role: string | null;
}

interface QRow {
  key: string;
  value: string;
}

interface QSection {
  heading: string;
  level: number;
  rows: QRow[];
}

interface ConfluencePage {
  page_id: string;
  fiscal_year: string;
  title: string;
  page_url: string;
  body_size_chars: number | null;
  q_project_id: string | null;
  q_project_name: string | null;
  q_pm: string | null;
  q_pm_name: string | null;
  q_it_lead: string | null;
  q_it_lead_name: string | null;
  q_dt_lead: string | null;
  q_dt_lead_name: string | null;
  questionnaire_sections: QSection[] | null;
}

interface Attachment {
  attachment_id: string;
  page_id: string;
  title: string;
  file_kind: string;
  file_size: number | null;
  local_path: string | null;
}

interface GraphApp {
  app_id: string;
  name: string;
  status: string;
  cmdb_linked: boolean;
}

interface GraphEdge {
  source_app_id: string;
  target_app_id: string;
  interaction_type: string;
  business_object: string;
  status: string;
}

interface Overview {
  project_id: string;
  mspo: MSPO | null;
  summary: ProjectSummary | null;
  team: TeamMember[];
  confluence_pages: ConfluencePage[];
  attachments: Attachment[];
  graph: {
    applications: GraphApp[];
    integrations: GraphEdge[];
  };
}

const KIND_LABEL: Record<string, string> = {
  drawio: "draw.io",
  image: "Image",
  pdf: "PDF",
  office: "Office",
  xml: "XML",
  other: "Other",
};

const KIND_COLOR: Record<string, string> = {
  drawio: "var(--accent)",
  image: "#5fc58a",
  pdf: "#e8716b",
  office: "#6ba6e8",
  xml: "#a8b0c0",
  other: "#6b7488",
};

const STATUS_COLORS: Record<string, string> = {
  Active: "#5fc58a",
  Keep: "#6ba6e8",
  Change: "#e8b458",
  New: "#e8716b",
  Sunset: "#6b7488",
  "3rd Party": "#a8b0c0",
  Unknown: "#5f6a80",
  Decommissioned: "#6b7488",
};

function humanSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export default function ProjectOverviewPage() {
  const params = useParams();
  const projectId = params.project_id as string;
  const [data, setData] = useState<Overview | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/admin/projects/${projectId}/overview`, {
          cache: "no-store",
        });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setData(j.data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [projectId]);

  if (err)
    return (
      <div>
        <Link href="/admin/projects" style={{ color: "var(--text-muted)" }}>
          ← All projects
        </Link>
        <div className="panel" style={{ marginTop: 16, borderColor: "#5b1f1f" }}>{err}</div>
      </div>
    );
  if (!data) return <div className="subtitle">Loading…</div>;

  const { mspo, summary, team, confluence_pages, attachments, graph } = data;
  const primaryPage = confluence_pages[0] ?? null;
  const projectName = mspo?.project_name || primaryPage?.q_project_name || projectId;

  const attachmentsByKind: Record<string, Attachment[]> = {};
  for (const a of attachments) {
    if (!attachmentsByKind[a.file_kind]) attachmentsByKind[a.file_kind] = [];
    attachmentsByKind[a.file_kind].push(a);
  }

  return (
    <div>
      <Link href="/admin/projects" style={{ color: "var(--text-muted)", fontSize: 13 }}>
        ← All projects
      </Link>
      <div style={{ marginTop: 12, marginBottom: 8 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--accent)",
            marginBottom: 6,
          }}
        >
          <code>{projectId}</code>
        </div>
        <h1 style={{ margin: 0 }}>{projectName}</h1>
      </div>

      {/* Source badges */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24, flexWrap: "wrap", fontSize: 11 }}>
        <SourceBadge label="MSPO" active={!!mspo} count={mspo ? 1 : 0} />
        <SourceBadge label="Summary" active={!!summary} count={summary ? 1 : 0} />
        <SourceBadge label="Team" active={team.length > 0} count={team.length} />
        <SourceBadge label="Confluence" active={confluence_pages.length > 0} count={confluence_pages.length} />
        <SourceBadge label="Attachments" active={attachments.length > 0} count={attachments.length} />
        <SourceBadge label="Graph" active={graph.applications.length > 0} count={graph.applications.length} />
      </div>

      {/* MSPO + Confluence side-by-side */}
      <div className="panel-grid">
        <div className="panel">
          <div className="panel-title">MSPO Master (EAM)</div>
          {mspo ? (
            <table>
              <tbody>
                <KVRow k="Project Name" v={mspo.project_name} />
                <KVRow k="Type" v={mspo.type} />
                <KVRow k="Status" v={mspo.status} />
                <KVRow k="Overall Status" v={mspo.overall_status} />
                <KVRow
                  k="PM"
                  v={mspo.pm_itcode ? `${mspo.pm || "—"} (${mspo.pm_itcode})` : mspo.pm}
                />
                <KVRow
                  k="IT Lead"
                  v={mspo.it_lead_itcode ? `${mspo.it_lead || "—"} (${mspo.it_lead_itcode})` : mspo.it_lead}
                />
                <KVRow
                  k="DT Lead"
                  v={mspo.dt_lead_itcode ? `${mspo.dt_lead || "—"} (${mspo.dt_lead_itcode})` : mspo.dt_lead}
                />
                <KVRow k="Start Date" v={mspo.start_date} />
                <KVRow k="Go-live Date" v={mspo.go_live_date} />
                <KVRow k="PPS Exit Date" v={mspo.pps_exit_date} />
                <KVRow k="End Date" v={mspo.end_date} />
                <KVRow k="EA Approval Date" v={mspo.ea_approval_dt} />
                <KVRow k="Approved Time" v={mspo.approved_time} />
                <KVRow k="EA Review Type" v={mspo.ea_review_type} />
                <KVRow k="EA Reviewer" v={mspo.domain_ea_reviewer} />
                <KVRow k="AI-related" v={mspo.ai_related} />
                <KVRow k="Source" v={mspo.source} />
              </tbody>
            </table>
          ) : (
            <div className="empty">Not in MSPO master data.</div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">Confluence Questionnaire</div>
          {primaryPage ? (
            <table>
              <tbody>
                <tr>
                  <th style={{ width: "30%" }}>Page</th>
                  <td>
                    <Link
                      href={`/admin/confluence/${primaryPage.page_id}`}
                      style={{ color: "var(--accent)" }}
                    >
                      {primaryPage.title}
                    </Link>
                  </td>
                </tr>
                <KVRow k="Fiscal Year" v={primaryPage.fiscal_year} mono />
                <KVRow k="Project ID" v={primaryPage.q_project_id} mono />
                <KVRow k="Project Name" v={primaryPage.q_project_name} />
                <KVRow
                  k="PM"
                  v={
                    primaryPage.q_pm_name
                      ? `${primaryPage.q_pm_name} (${primaryPage.q_pm})`
                      : primaryPage.q_pm
                  }
                />
                <KVRow
                  k="IT Lead"
                  v={
                    primaryPage.q_it_lead_name
                      ? `${primaryPage.q_it_lead_name} (${primaryPage.q_it_lead})`
                      : primaryPage.q_it_lead
                  }
                />
                <KVRow
                  k="DT Lead"
                  v={
                    primaryPage.q_dt_lead_name
                      ? `${primaryPage.q_dt_lead_name} (${primaryPage.q_dt_lead})`
                      : primaryPage.q_dt_lead
                  }
                />
                <tr>
                  <th>Source</th>
                  <td>
                    <a
                      href={primaryPage.page_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: "var(--accent)", fontSize: 12 }}
                    >
                      Open in Confluence ↗
                    </a>
                  </td>
                </tr>
                <KVRow
                  k="Body Size"
                  v={primaryPage.body_size_chars?.toLocaleString() ?? null}
                  mono
                />
              </tbody>
            </table>
          ) : (
            <div className="empty">No Confluence page scanned for this project.</div>
          )}
        </div>
      </div>

      {/* Objectives (full text from MSPO) */}
      {mspo?.objectives && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Objectives</div>
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.6,
              color: "var(--text)",
              whiteSpace: "pre-wrap",
            }}
          >
            {mspo.objectives}
          </div>
        </div>
      )}

      {/* Financial */}
      {(mspo?.investment_cost != null ||
        mspo?.yearly_ma_cost != null ||
        mspo?.expected_man_days != null) && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Financial</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 24,
            }}
          >
            <MoneyStat label="Investment Cost" k={mspo.investment_cost} />
            <MoneyStat label="Yearly M&A Cost" k={mspo.yearly_ma_cost} />
            <PlainStat
              label="Expected Man-days"
              v={mspo.expected_man_days}
            />
            <PlainStat label="Duration (months)" v={mspo.duration} />
          </div>
        </div>
      )}

      {/* Team members */}
      {team.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Team Members ({team.length})</div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 140 }}>itcode</th>
                <th>Name</th>
                <th style={{ width: 100 }}>Type</th>
                <th style={{ width: 120 }}>Manager</th>
                <th>Org</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.itcode}>
                  <td>
                    <code>{m.itcode}</code>
                  </td>
                  <td>{m.name || "—"}</td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    {m.worker_type || "—"}
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    <code>{m.manager_itcode || "—"}</code>
                  </td>
                  <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                    {m.tier_2_org || m.tier_1_org || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Business Summary (from eam_project_summary) */}
      {summary && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Business Summary</div>
          <table>
            <tbody>
              <KVRow k="Business Owner 1" v={summary.business_owner1} />
              <KVRow k="Business Owner 2" v={summary.business_owner2} />
              <KVRow k="Schedule" v={summary.schedule} />
              <KVRow k="Cost" v={summary.cost} />
              <KVRow k="EA Status" v={summary.ea_status} />
              <KVRow k="EA Review Submitter" v={summary.ea_review_submitter} />
              {summary.function_summary && (
                <tr>
                  <th style={{ width: "30%", verticalAlign: "top" }}>Function Summary</th>
                  <td
                    style={{
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.6,
                    }}
                  >
                    {summary.function_summary}
                  </td>
                </tr>
              )}
              {summary.benefit && (
                <tr>
                  <th style={{ width: "30%", verticalAlign: "top" }}>Benefit</th>
                  <td
                    style={{
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.6,
                    }}
                  >
                    {summary.benefit}
                  </td>
                </tr>
              )}
              {summary.paint_point && (
                <tr>
                  <th style={{ width: "30%", verticalAlign: "top" }}>Pain Point</th>
                  <td
                    style={{
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.6,
                    }}
                  >
                    {summary.paint_point}
                  </td>
                </tr>
              )}
              {summary.architect_summary && (
                <tr>
                  <th style={{ width: "30%", verticalAlign: "top" }}>Architect Summary</th>
                  <td
                    style={{
                      fontSize: 13,
                      whiteSpace: "pre-wrap",
                      lineHeight: 1.6,
                    }}
                  >
                    {summary.architect_summary}
                  </td>
                </tr>
              )}
              {summary.application_list && summary.application_list.length > 0 && (
                <tr>
                  <th style={{ width: "30%", verticalAlign: "top" }}>
                    Applications ({summary.application_list.length})
                  </th>
                  <td>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {summary.application_list.map((app, i) => (
                        <code
                          key={i}
                          style={{
                            background: "var(--surface-hover)",
                            padding: "3px 8px",
                            borderRadius: 3,
                            fontSize: 11,
                          }}
                        >
                          {app}
                        </code>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Additional pages if any */}
      {confluence_pages.length > 1 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">Additional Confluence pages ({confluence_pages.length - 1})</div>
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>FY</th>
                <th>Body size</th>
              </tr>
            </thead>
            <tbody>
              {confluence_pages.slice(1).map((p) => (
                <tr key={p.page_id}>
                  <td>
                    <Link
                      href={`/admin/confluence/${p.page_id}`}
                      style={{ color: "var(--text)" }}
                    >
                      {p.title}
                    </Link>
                  </td>
                  <td>
                    <code>{p.fiscal_year}</code>
                  </td>
                  <td
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "var(--text-dim)",
                    }}
                  >
                    {p.body_size_chars?.toLocaleString() ?? "—"} chars
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <td>
                    <span
                      style={{
                        color: KIND_COLOR[a.file_kind] || "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      }}
                    >
                      {KIND_LABEL[a.file_kind] || a.file_kind}
                    </span>
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

      {/* Graph */}
      {graph.applications.length > 0 && (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="panel-title">
            Graph — {graph.applications.length} applications · {graph.integrations.length}{" "}
            integrations
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 16,
            }}
          >
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
                Applications
              </div>
              <table>
                <tbody>
                  {graph.applications.map((a) => (
                    <tr key={a.app_id}>
                      <td style={{ width: 110 }}>
                        {a.cmdb_linked ? (
                          <Link
                            href={`/admin/applications/${encodeURIComponent(a.app_id)}`}
                            style={{ color: "var(--accent)" }}
                          >
                            <code>{a.app_id}</code>
                          </Link>
                        ) : (
                          <code style={{ color: "var(--text-dim)" }}>{a.app_id}</code>
                        )}
                      </td>
                      <td>{a.name}</td>
                      <td style={{ width: 110 }}>
                        <span
                          className="status-pill"
                          style={{
                            background: `${STATUS_COLORS[a.status] || "#5f6a80"}26`,
                            color: STATUS_COLORS[a.status] || "var(--text-muted)",
                          }}
                        >
                          {a.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
                Integrations
              </div>
              {graph.integrations.length === 0 ? (
                <div className="empty" style={{ padding: 20 }}>
                  No internal integrations.
                </div>
              ) : (
                <table>
                  <tbody>
                    {graph.integrations.map((e, i) => (
                      <tr key={i}>
                        <td style={{ width: 110 }}>
                          <code>{e.source_app_id}</code>
                        </td>
                        <td
                          style={{
                            color: "var(--text-dim)",
                            fontFamily: "var(--font-mono)",
                            fontSize: 11,
                            width: 30,
                          }}
                        >
                          →
                        </td>
                        <td style={{ width: 110 }}>
                          <code>{e.target_app_id}</code>
                        </td>
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

      {/* Full questionnaire from primary page */}
      {primaryPage?.questionnaire_sections && primaryPage.questionnaire_sections.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              color: "var(--text-muted)",
              marginBottom: 10,
            }}
          >
            Full Questionnaire (from primary page)
          </div>
          {primaryPage.questionnaire_sections.map((s, i) => (
            <details
              key={i}
              className="panel"
              style={{ marginBottom: 10, padding: "14px 20px" }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "var(--text)",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--accent)",
                    marginRight: 8,
                  }}
                >
                  H{s.level || "-"}
                </span>
                {s.heading || "(unnamed)"}
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 10,
                    color: "var(--text-dim)",
                    marginLeft: 8,
                  }}
                >
                  {s.rows.length} rows
                </span>
              </summary>
              <table style={{ marginTop: 14 }}>
                <tbody>
                  {s.rows.map((r, j) => (
                    <tr key={j}>
                      <th style={{ width: "30%", verticalAlign: "top" }}>{r.key || "—"}</th>
                      <td
                        style={{
                          fontSize: 13,
                          whiteSpace: "pre-wrap",
                          wordBreak: "break-word",
                        }}
                      >
                        {r.value || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      )}
    </div>
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

function KVRow({ k, v, mono }: { k: string; v: string | null; mono?: boolean }) {
  return (
    <tr>
      <th style={{ width: "30%" }}>{k}</th>
      <td
        style={{
          fontFamily: mono ? "var(--font-mono)" : undefined,
          fontSize: mono ? 12 : 13,
          color: v ? "var(--text)" : "var(--text-dim)",
        }}
      >
        {v || "—"}
      </td>
    </tr>
  );
}

function MoneyStat({ label, k }: { label: string; k: number | null }) {
  const display =
    k == null
      ? "—"
      : Math.abs(k) < 1000
      ? `$${k.toFixed(2)}k`
      : `$${(k / 1000).toFixed(2)}M`;
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
          color: k == null ? "var(--text-dim)" : "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {display}
      </div>
    </div>
  );
}

function PlainStat({ label, v }: { label: string; v: number | null }) {
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
          color: v == null ? "var(--text-dim)" : "var(--text)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {v == null ? "—" : v.toLocaleString()}
      </div>
    </div>
  );
}

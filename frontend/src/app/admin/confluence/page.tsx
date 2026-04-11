"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Pager } from "@/components/Pager";

interface PageRow {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  project_name_source: "mspo" | "questionnaire" | "none";
  app_id: string | null;
  app_name: string | null;
  app_name_source: "cmdb" | "none";
  page_type: string | null; // 'project' | 'application' | 'other'
  project_in_mspo: boolean;
  app_in_cmdb: boolean;
  q_pm: string | null;
  q_it_lead: string | null;
  q_dt_lead: string | null;
  page_url: string;
  attachment_count: number;
  drawio_count: number;
}

interface ListResult {
  total: number;
  rows: PageRow[];
}

interface Summary {
  by_fy: { fiscal_year: string; pages: number }[];
  by_kind: { file_kind: string; n: number }[];
  // Non-user-facing editor noise (drawio-backup*, ~*.tmp), split out so the
  // UI can mention it without polluting the real attachment KPI.
  by_kind_backup: { file_kind: string; n: number }[];
  by_type: { type: string; n: number }[];
  totals: {
    total_pages: number;
    total_attachments: number;
    total_backup_attachments: number;
    downloaded: number;
    projects_linked_mspo: number;
    apps_linked_cmdb: number;
  };
}

const PAGE_SIZE = 50;

export default function ConfluenceIndex() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [fy, setFy] = useState("");
  const [pageType, setPageType] = useState("");
  const [hasDrawio, setHasDrawio] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/admin/confluence/summary", { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setSummary(j.data);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (qDebounced) params.set("q", qDebounced);
        if (fy) params.set("fiscal_year", fy);
        if (pageType) params.set("page_type", pageType);
        if (hasDrawio) params.set("has_drawio", "true");
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        const r = await fetch(`/api/admin/confluence/pages?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        if (!cancelled) setData(j.data);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qDebounced, fy, pageType, hasDrawio, page]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  // Row-group metadata for rowspan-style folding. The backend now returns
  // rows strictly sorted by (fiscal_year, project_id, title, app_id), so
  // every sibling of a group is adjacent to its primary within the current
  // page. We walk the rows once and compute:
  //   position      : "solo" | "first" | "sibling"
  //   groupSize     : total row count of the group the row belongs to
  //                   (only meaningful on "first"; used by the "+N more" pill)
  //   isPageContinuation : true iff the row at index 0 is a "sibling" —
  //                        meaning the group's primary is on the previous
  //                        page. We render a small caption to hint at that.
  const groupInfo = useMemo(() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) {
      return {
        positions: [] as Array<"solo" | "first" | "sibling">,
        groupSizes: [] as number[],
        isPageContinuation: false,
      };
    }
    const positions: Array<"solo" | "first" | "sibling"> = new Array(rows.length);
    const groupSizes: number[] = new Array(rows.length).fill(1);

    // Two rows belong to the same group iff both have a non-null project_id
    // AND project_id + fiscal_year match. Orphan rows (no project_id) are
    // always "solo".
    const sameGroup = (a: PageRow, b: PageRow): boolean =>
      a.project_id != null &&
      b.project_id != null &&
      a.project_id === b.project_id &&
      a.fiscal_year === b.fiscal_year;

    let groupStart = 0;
    for (let i = 0; i <= rows.length; i++) {
      // Close the current run when we either hit EOF or a non-adjacent row
      if (i === rows.length || (i > groupStart && !sameGroup(rows[i - 1], rows[i]))) {
        const runLength = i - groupStart;
        if (runLength === 1 || rows[groupStart].project_id == null) {
          // Single row or orphan → solo
          for (let j = groupStart; j < i; j++) {
            positions[j] = "solo";
            groupSizes[j] = 1;
          }
        } else {
          // Multi-row group
          positions[groupStart] = "first";
          groupSizes[groupStart] = runLength;
          for (let j = groupStart + 1; j < i; j++) {
            positions[j] = "sibling";
            groupSizes[j] = runLength;
          }
        }
        groupStart = i;
      }
    }

    return {
      positions,
      groupSizes,
      // Page-continuation heuristic: the first row of the page is a sibling,
      // which means its primary lives on the previous page. Only relevant
      // when page > 0.
      isPageContinuation: page > 0 && positions[0] === "sibling",
    };
  }, [data, page]);

  return (
    <div>
      <h1>Confluence Raw Data</h1>
      <p className="subtitle">
        Every project page scanned from the ARD space, with all attachments (drawio, png,
        pdf, ppt) — scanned by <code>scripts/scan_confluence.py</code>.
      </p>

      {summary && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-label">Pages scanned</div>
            <div className="kpi-value">{summary.totals.total_pages?.toLocaleString() ?? 0}</div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-muted)",
              }}
            >
              {summary.by_type?.map((t) => (
                <span key={t.type}>
                  {t.type}:{" "}
                  <strong style={{ color: "var(--text)" }}>{t.n.toLocaleString()}</strong>
                </span>
              ))}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Linked to MSPO</div>
            <div className="kpi-value">
              {summary.totals.projects_linked_mspo?.toLocaleString() ?? 0}
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              project pages with LI/RD id in ref_project
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Linked to CMDB</div>
            <div className="kpi-value">
              {summary.totals.apps_linked_cmdb?.toLocaleString() ?? 0}
            </div>
            <div
              style={{
                marginTop: 6,
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              application pages with A-id in ref_application
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Attachments</div>
            <div className="kpi-value">
              {summary.totals.downloaded?.toLocaleString() ?? 0}
              <span
                style={{
                  fontSize: 14,
                  color: "var(--text-dim)",
                  fontWeight: 400,
                  marginLeft: 6,
                }}
              >
                / {summary.totals.total_attachments?.toLocaleString() ?? 0}
              </span>
            </div>
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-muted)",
              }}
            >
              {summary.by_kind.map((k) => (
                <span key={k.file_kind}>
                  {k.file_kind}:{" "}
                  <strong style={{ color: "var(--text)" }}>{k.n.toLocaleString()}</strong>
                </span>
              ))}
            </div>
            {summary.totals.total_backup_attachments > 0 && (
              <div
                style={{
                  marginTop: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 9,
                  color: "var(--text-dim)",
                  fontStyle: "italic",
                }}
                title="drawio-backup-* and ~*.tmp files — draw.io editor auto-save artifacts. Hidden from the count above. Run scripts/cleanup_backup_attachments.py to remove from PG."
              >
                +{summary.totals.total_backup_attachments.toLocaleString()} editor backup rows
                hidden
              </div>
            )}
          </div>
        </div>
      )}

      <div className="toolbar">
        <input
          placeholder="Search by title or project ID…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <select value={fy} onChange={(e) => setFy(e.target.value)}>
          <option value="">All fiscal years</option>
          {summary?.by_fy.map((f) => (
            <option key={f.fiscal_year} value={f.fiscal_year}>
              {f.fiscal_year} ({f.pages})
            </option>
          ))}
        </select>
        <select
          value={pageType}
          onChange={(e) => {
            setPageType(e.target.value);
            setPage(0);
          }}
        >
          <option value="">All types</option>
          {summary?.by_type?.map((t) => (
            <option key={t.type} value={t.type}>
              {t.type} ({t.n.toLocaleString()})
            </option>
          ))}
        </select>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={hasDrawio}
            onChange={(e) => setHasDrawio(e.target.checked)}
          />
          Has drawio
        </label>
        <div style={{ flex: 1 }} />
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-dim)",
          }}
        >
          {loading ? "loading…" : `${total.toLocaleString()} results`}
        </div>
      </div>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>FY</th>
              <th style={{ width: 110 }}>Project ID</th>
              <th>Project Name</th>
              <th style={{ width: 100 }}>App ID</th>
              <th>App Name</th>
              <th style={{ width: 80, textAlign: "right" }}>Attach.</th>
              <th style={{ width: 80, textAlign: "right" }}>Drawio</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {/* Cross-page continuation caption: when page 2+ opens with a
                sibling row, its group's primary row lives on the previous
                page. A subtle caption row signals this so the user doesn't
                misread the amber-bound row as orphaned. */}
            {groupInfo.isPageContinuation && data && data.rows.length > 0 && (
              <tr>
                <td
                  colSpan={8}
                  style={{
                    padding: "6px 16px",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-dim)",
                    textTransform: "uppercase",
                    letterSpacing: 0.6,
                    background: "var(--bg-elevated)",
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  ↳ continuing group from previous page · project{" "}
                  <span style={{ color: "var(--text-muted)" }}>
                    {data.rows[0].project_id}
                  </span>
                </td>
              </tr>
            )}
            {data?.rows.map((r, idx) => {
              const position = groupInfo.positions[idx] ?? "solo";
              const groupSize = groupInfo.groupSizes[idx] ?? 1;
              const isSibling = position === "sibling";
              const isFirst = position === "first";

              // Sibling rows: the FY / Project ID / Project Name cells are
              // empty because they're visually "merged" with the primary row
              // above via the amber left border painted on the project_id
              // cell. The cells remain in DOM to keep column widths stable —
              // we don't fight the table layout engine.
              const bindingBorder = isSibling
                ? "2px solid var(--accent-dim)"
                : undefined;

              return (
                <tr key={r.page_id}>
                  {/* FY */}
                  <td>{isSibling ? null : <code>{r.fiscal_year}</code>}</td>
                  {/* Project ID — sibling rows get the 2px amber-dim left
                      border here. This is the "binding stripe" that ties
                      consecutive rows to the same project. */}
                  <td style={{ borderLeft: bindingBorder }}>
                    {isSibling ? null : (
                      <IdCell
                        id={r.project_id}
                        verified={r.project_in_mspo}
                        href={
                          r.project_in_mspo && r.project_id
                            ? `/admin/projects/${encodeURIComponent(r.project_id)}`
                            : undefined
                        }
                        kind="project"
                      />
                    )}
                  </td>
                  {/* Project name + optional "+N more" pill on primary rows */}
                  <td>
                    {isSibling ? null : (
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 8,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <NameCell
                            primary={r.project_name}
                            source={r.project_name_source}
                            fallback={r.page_type === "project" ? r.title : null}
                            pageId={r.page_id}
                          />
                        </div>
                        {isFirst && groupSize > 1 && (
                          <GroupSizePill count={groupSize - 1} />
                        )}
                      </div>
                    )}
                  </td>
                  {/* App ID — narrow fixed width. Unresolved hint brackets
                      (e.g. "[Robbie IT Service Agent]") get ellipsis truncation
                      via the nested overflow container; clean CMDB ids like
                      "A250197" fit comfortably in 100px. The tooltip on
                      IdCell still shows the full id/hint on hover. */}
                  <td style={{ maxWidth: 100, width: 100 }}>
                    <div
                      style={{
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <IdCell
                        id={r.app_id}
                        verified={r.app_in_cmdb}
                        href={
                          r.app_in_cmdb && r.app_id
                            ? `/admin/applications/${encodeURIComponent(r.app_id)}`
                            : undefined
                        }
                        kind="app"
                      />
                    </div>
                  </td>
                  {/* App name */}
                  <td>
                    <NameCell
                      primary={r.app_name}
                      source={r.app_name_source === "cmdb" ? "mspo" : "none"}
                      fallback={r.page_type === "application" ? r.title : null}
                      pageId={r.page_id}
                    />
                  </td>
                  {/* Attach count */}
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}
                  >
                    {r.attachment_count}
                  </td>
                  {/* Drawio count */}
                  <td
                    style={{
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color:
                        r.drawio_count > 0 ? "var(--accent)" : "var(--text-dim)",
                    }}
                  >
                    {r.drawio_count}
                  </td>
                  {/* Confluence link */}
                  <td style={{ textAlign: "right" }}>
                    <a
                      href={r.page_url}
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
              );
            })}
            {!loading && data?.rows.length === 0 && (
              <tr>
                <td colSpan={8} className="empty" style={{ padding: 40 }}>
                  No scanned pages. Run <code>scripts/scan_confluence.py</code> on 71.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager
        page={page}
        maxPage={maxPage}
        total={total}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  );
}

/**
 * GroupSizePill — rendered next to the project name on the "first" row of a
 * multi-row group. Communicates "+N more apps in this project" without the
 * reader having to count the sibling rows below.
 *
 * Reuses the existing Status pill shape from DESIGN.md (2px radius, 11px
 * caption, amber at ~14% opacity bg + full-strength text). Not a new token.
 */
function GroupSizePill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span
      title={`${count} more application${count === 1 ? "" : "s"} in this project — shown below, tied by the amber left border.`}
      style={{
        display: "inline-block",
        padding: "1px 6px",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        letterSpacing: 0.4,
        color: "var(--accent)",
        background: "rgba(246, 166, 35, 0.14)",
        border: "1px solid rgba(246, 166, 35, 0.35)",
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      +{count} more
    </span>
  );
}

function IdCell({
  id,
  verified,
  href,
  kind,
}: {
  id: string | null;
  verified: boolean;
  href?: string;
  kind: "project" | "app";
}) {
  if (!id) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  const color = verified
    ? kind === "app"
      ? "var(--accent)"
      : "#6ba6e8"
    : "#e8716b";
  const title = verified
    ? `${id} found in ${kind === "app" ? "CMDB ref_application" : "MSPO ref_project"}`
    : `${id} not found in ${kind === "app" ? "CMDB" : "MSPO"} (orphan)`;
  const dot = (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: color,
        marginRight: 6,
        verticalAlign: "middle",
        boxShadow: verified ? `0 0 0 1px ${color}66` : `0 0 0 1px #e8716b66`,
      }}
    />
  );
  const content = (
    <span
      title={title}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        color: verified ? "var(--text)" : "var(--text-muted)",
        whiteSpace: "nowrap",
      }}
    >
      {dot}
      {id}
    </span>
  );
  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {content}
      </Link>
    );
  }
  return content;
}

function NameCell({
  primary,
  source,
  fallback,
  pageId,
}: {
  primary: string | null;
  source: "mspo" | "questionnaire" | "none";
  fallback: string | null;
  pageId: string;
}) {
  const label = primary || fallback;
  if (!label) return <span style={{ color: "var(--text-dim)" }}>—</span>;

  // Three display tiers:
  //   mspo          → normal text, no italic   (authoritative master match)
  //   questionnaire → italic, muted             (from page body Q&A)
  //   none          → italic, dim               (fallback to page title)
  const style: Record<string, { color: string; italic: boolean; title: string }> = {
    mspo: {
      color: "var(--text)",
      italic: false,
      title: "From MSPO / CMDB master",
    },
    questionnaire: {
      color: "var(--text-muted)",
      italic: true,
      title: "From Confluence questionnaire body",
    },
    none: {
      color: "var(--text-muted)",
      italic: true,
      title: "From Confluence page title (no master, no questionnaire match)",
    },
  };
  const s = style[source];
  return (
    <Link
      href={`/admin/confluence/${pageId}`}
      style={{
        color: s.color,
        fontSize: 13,
        fontStyle: s.italic ? "italic" : "normal",
      }}
      title={s.title}
    >
      {label}
    </Link>
  );
}

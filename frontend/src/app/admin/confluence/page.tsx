"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PageRow {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  app_id: string | null;
  app_name: string | null;
  page_type: string | null; // 'project' | 'application' | 'other'
  project_in_mspo: boolean;
  app_in_cmdb: boolean;
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
  by_type: { type: string; n: number }[];
  totals: {
    total_pages: number;
    total_attachments: number;
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
              <th style={{ width: 110 }}>App ID</th>
              <th>App Name</th>
              <th style={{ width: 80, textAlign: "right" }}>Attach.</th>
              <th style={{ width: 80, textAlign: "right" }}>Drawio</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.page_id}>
                <td>
                  <code>{r.fiscal_year}</code>
                </td>
                <td>
                  <IdCell
                    id={r.project_id}
                    verified={r.project_in_mspo}
                    href={r.project_in_mspo && r.project_id
                      ? `/admin/projects/${encodeURIComponent(r.project_id)}`
                      : undefined}
                    kind="project"
                  />
                </td>
                <td>
                  <NameCell
                    primary={r.project_name}
                    fallback={r.page_type === "project" ? r.title : null}
                    pageId={r.page_id}
                    muted={!r.project_name}
                  />
                </td>
                <td>
                  <IdCell
                    id={r.app_id}
                    verified={r.app_in_cmdb}
                    href={r.app_in_cmdb && r.app_id
                      ? `/admin/applications?q=${encodeURIComponent(r.app_id)}`
                      : undefined}
                    kind="app"
                  />
                </td>
                <td>
                  <NameCell
                    primary={r.app_name}
                    fallback={r.page_type === "application" ? r.title : null}
                    pageId={r.page_id}
                    muted={!r.app_name}
                  />
                </td>
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
                <td
                  style={{
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: r.drawio_count > 0 ? "var(--accent)" : "var(--text-dim)",
                  }}
                >
                  {r.drawio_count}
                </td>
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
            ))}
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

      <div
        style={{
          display: "flex",
          gap: 8,
          marginTop: 14,
          alignItems: "center",
          justifyContent: "flex-end",
        }}
      >
        <button
          className="btn-secondary"
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          disabled={page === 0 || loading}
        >
          ← Prev
        </button>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            color: "var(--text-muted)",
            padding: "0 8px",
          }}
        >
          {page + 1} / {maxPage + 1}
        </div>
        <button
          className="btn-secondary"
          onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
          disabled={page >= maxPage || loading}
        >
          Next →
        </button>
      </div>
    </div>
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
  fallback,
  pageId,
  muted,
}: {
  primary: string | null;
  fallback: string | null;
  pageId: string;
  muted?: boolean;
}) {
  const label = primary || fallback;
  if (!label) return <span style={{ color: "var(--text-dim)" }}>—</span>;
  return (
    <Link
      href={`/admin/confluence/${pageId}`}
      style={{
        color: muted ? "var(--text-muted)" : "var(--text)",
        fontSize: 13,
        fontStyle: primary ? "normal" : "italic",
      }}
      title={primary ? "From MSPO / CMDB" : "From Confluence page title (no master match)"}
    >
      {label}
    </Link>
  );
}

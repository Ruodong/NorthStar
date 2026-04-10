"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface PageRow {
  page_id: string;
  fiscal_year: string;
  title: string;
  project_id: string | null;
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
  totals: { total_pages: number; total_attachments: number; downloaded: number };
}

const PAGE_SIZE = 50;

export default function ConfluenceIndex() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [fy, setFy] = useState("");
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
    setPage(0);
  }, [qDebounced, fy, hasDrawio]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const params = new URLSearchParams();
        if (qDebounced) params.set("q", qDebounced);
        if (fy) params.set("fiscal_year", fy);
        if (hasDrawio) params.set("has_drawio", "true");
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        const r = await fetch(`/api/admin/confluence/pages?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        setData(j.data);
      } catch (e) {
        setErr(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [qDebounced, fy, hasDrawio, page]);

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
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Attachments</div>
            <div className="kpi-value">
              {summary.totals.total_attachments?.toLocaleString() ?? 0}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Downloaded</div>
            <div className="kpi-value">{summary.totals.downloaded?.toLocaleString() ?? 0}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Kinds</div>
            <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {summary.by_kind.map((k) => (
                <span
                  key={k.file_kind}
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                >
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
              <th style={{ width: 80 }}>FY</th>
              <th style={{ width: 130 }}>Project ID</th>
              <th>Title</th>
              <th style={{ width: 120, textAlign: "right" }}>Attachments</th>
              <th style={{ width: 100, textAlign: "right" }}>Drawio</th>
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
                  <code>{r.project_id || "—"}</code>
                </td>
                <td>
                  <Link
                    href={`/admin/confluence/${r.page_id}`}
                    style={{ color: "var(--text)" }}
                  >
                    {r.title}
                  </Link>
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
                <td colSpan={6} className="empty" style={{ padding: 40 }}>
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

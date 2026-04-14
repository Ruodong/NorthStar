"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pager } from "@/components/Pager";

interface ProjectRow {
  project_id: string;
  project_name: string | null;
  type: string | null;
  status: string | null;
  pm: string | null;
  it_lead: string | null;
  dt_lead: string | null;
  start_date: string | null;
  go_live_date: string | null;
  source: string | null;
  app_count: number;
  new_count: number;
  change_count: number;
  sunset_count: number;
}

interface ListResult {
  total: number;
  rows: ProjectRow[];
}

const PAGE_SIZE = 50;

const ROLE_COLORS: Record<string, string> = {
  New: "#5fc58a",
  Change: "#6ba6e8",
  Sunset: "#e8716b",
};

export default function ProjectsPage() {
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => { setQDebounced(q); setPage(0); }, 250);
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
        params.set("limit", String(PAGE_SIZE));
        params.set("offset", String(page * PAGE_SIZE));
        const r = await fetch(`/api/masters/projects?${params}`, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        if (!cancelled) setData(j.data);
      } catch (e) {
        if (!cancelled) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [qDebounced, page]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div>
      <h1>Projects</h1>
      <p className="subtitle">
        Architecture review projects from MSPO ({data?.total.toLocaleString() ?? "\u2026"} projects).
        Sorted by application impact. Click any project to see impacted applications.
      </p>

      <div className="toolbar">
        <input
          placeholder="Search by project name, ID, or PM\u2026"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ minWidth: 320 }}
        />
        <div style={{ flex: 1 }} />
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>
          {loading ? "loading\u2026" : `${total.toLocaleString()} results`}
        </div>
      </div>

      {err && <div className="panel" style={{ borderColor: "#5b1f1f" }}>Error: {err}</div>}

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 110 }}>Project ID</th>
              <th>Name</th>
              <th style={{ width: 90 }}>Status</th>
              <th style={{ width: 100 }}>PM</th>
              <th style={{ width: 80, textAlign: "center" }}>Apps</th>
              <th style={{ width: 160, textAlign: "center" }}>Impact Breakdown</th>
              <th style={{ width: 90 }}>Go-Live</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr key={r.project_id}>
                <td>
                  <Link href={`/projects/${encodeURIComponent(r.project_id)}`} style={{ color: "var(--accent)" }}>
                    <code>{r.project_id}</code>
                  </Link>
                </td>
                <td>
                  <Link href={`/projects/${encodeURIComponent(r.project_id)}`} style={{ color: "var(--text)", textDecoration: "none" }}>
                    {r.project_name || "\u2014"}
                  </Link>
                </td>
                <td>
                  {r.status ? (
                    <span className="status-pill" style={{ color: "var(--text-muted)", background: "var(--surface-hover)" }}>
                      {r.status}
                    </span>
                  ) : <span style={{ color: "var(--text-dim)", fontSize: 12 }}>\u2014</span>}
                </td>
                <td style={{ color: "var(--text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 100 }}>
                  {r.pm || "\u2014"}
                </td>
                <td style={{ textAlign: "center" }}>
                  {r.app_count > 0 ? (
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {r.app_count}
                    </span>
                  ) : (
                    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>\u2014</span>
                  )}
                </td>
                <td style={{ textAlign: "center" }}>
                  {r.app_count > 0 ? (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                      {r.new_count > 0 && (
                        <span style={{ fontSize: 11, color: ROLE_COLORS.New }}>
                          +{r.new_count} new
                        </span>
                      )}
                      {r.change_count > 0 && (
                        <span style={{ fontSize: 11, color: ROLE_COLORS.Change }}>
                          {r.change_count} change
                        </span>
                      )}
                      {r.sunset_count > 0 && (
                        <span style={{ fontSize: 11, color: ROLE_COLORS.Sunset }}>
                          {r.sunset_count} sunset
                        </span>
                      )}
                    </div>
                  ) : null}
                </td>
                <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)" }}>
                  {r.go_live_date || "\u2014"}
                </td>
              </tr>
            ))}
            {!loading && data?.rows.length === 0 && (
              <tr><td colSpan={7} className="empty" style={{ padding: 40 }}>No results.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager page={page} maxPage={maxPage} total={total} pageSize={PAGE_SIZE} loading={loading} onPageChange={setPage} />
    </div>
  );
}

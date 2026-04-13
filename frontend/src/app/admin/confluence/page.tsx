"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
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
  app_name_source: "cmdb" | "none" | "hint_unresolved";
  page_type: string | null; // 'project' | 'application' | 'other'
  project_in_mspo: boolean;
  app_in_cmdb: boolean;
  project_apps?: { app_id: string | null; app_name: string | null; app_in_cmdb: boolean }[];
  q_pm: string | null;
  q_it_lead: string | null;
  q_dt_lead: string | null;
  page_url: string;
  attachment_count: number;
  drawio_count: number;
  project_app_total?: number;
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

// sessionStorage key for scroll position restore across back-nav.
// Tab-scoped, cleared on tab close — never leaks across sessions.
const SCROLL_STORAGE_KEY = "northstar.admin.confluence.scroll";

// Module-level cache: maps API URL → response. Survives component
// unmount/remount within the same JS context (client-side navigation in
// Next.js preserves the module). Cleared on full-page reload (F5).
// This gives instant back-nav — the table renders from cache while a
// background fetch silently refreshes the data.
// Capped at 20 entries to prevent unbounded growth during long sessions.
// On eviction, the oldest entry is removed (FIFO, not true LRU, but
// sufficient for pagination caching where back-nav hits recent pages).
const _LIST_CACHE_MAX = 20;
const _listCache = new Map<string, ListResult>();
function _listCacheSet(key: string, value: ListResult) {
  _listCache.set(key, value);
  if (_listCache.size > _LIST_CACHE_MAX) {
    const oldest = _listCache.keys().next().value;
    if (oldest !== undefined) _listCache.delete(oldest);
  }
}
const _summaryCache: { data: Summary | null } = { data: null };

export default function ConfluenceIndex() {
  const pathname = usePathname();

  const [summary, setSummary] = useState<Summary | null>(null);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [fy, setFy] = useState("");
  const [pageType, setPageType] = useState("");
  const [hasDrawio, setHasDrawio] = useState(false);
  // Default: show only direct children of each project (depth <= 2), to
  // match what the user sees in Confluence. Flip on to reveal depth-3
  // grandchildren promoted as independent app rows by Pattern E.
  const [includeDeep, setIncludeDeep] = useState(false);
  // Default: hide project-folder pages that have NO Confluence content
  // anywhere (no attachments on themselves or their direct children).
  // Flip ON to "Show empty stubs" to see everything including the
  // FY2526-xxx project stubs with only a title.
  const [showEmpty, setShowEmpty] = useState(false);
  const [page, setPage] = useState(0);
  const [data, setData] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Two-phase mount for URL state: defaults first (matches SSR so no
  // hydration mismatch), then a post-mount effect reads the URL and
  // applies the stored filter/page values. `hydrated` flips to true after
  // that effect runs so the URL-sync effect doesn't clobber the URL with
  // defaults on the very first render.
  const [hydrated, setHydrated] = useState(false);
  // Scroll restore runs once per mount, after data lands. Gate with a ref
  // so rerenders don't keep overwriting the user's subsequent scrolling.
  const scrollRestoredRef = useRef(false);

  // Step 1 of URL state round-trip: on first client mount, read the URL
  // and apply it to state. Runs once.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const urlQ = sp.get("q") ?? "";
    setQ(urlQ);
    setQDebounced(urlQ);
    setFy(sp.get("fy") ?? "");
    setPageType(sp.get("page_type") ?? "");
    setHasDrawio(sp.get("has_drawio") === "1");
    setIncludeDeep(sp.get("include_deep") === "1");
    setShowEmpty(sp.get("show_empty") === "1");
    setPage(Math.max(0, Number(sp.get("page") ?? "0")));
    setHydrated(true);
  }, []);

  // Step 2: sync state → URL on every change (once hydrated).
  // `window.history.replaceState` is deliberately used instead of
  // `router.replace` so the URL update is silent — no re-render, no data
  // re-fetch, just a cheap history entry mutation the browser preserves
  // on back-nav.
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams();
    if (qDebounced) params.set("q", qDebounced);
    if (fy) params.set("fy", fy);
    if (pageType) params.set("page_type", pageType);
    if (hasDrawio) params.set("has_drawio", "1");
    if (includeDeep) params.set("include_deep", "1");
    if (showEmpty) params.set("show_empty", "1");
    if (page > 0) params.set("page", String(page));
    const qs = params.toString();
    const newUrl = qs ? `${pathname}?${qs}` : pathname;
    window.history.replaceState(null, "", newUrl);
  }, [hydrated, qDebounced, fy, pageType, hasDrawio, includeDeep, showEmpty, page, pathname]);

  // Scroll position persistence: save on every scroll (throttled via rAF).
  // Restore once, after data for the first mount lands. We key off the
  // URL so each distinct filter/page combo has its own remembered scroll,
  // but in practice the URL is stable across the user's round trip.
  useEffect(() => {
    let rafId: number | null = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        try {
          sessionStorage.setItem(
            SCROLL_STORAGE_KEY,
            JSON.stringify({
              url: window.location.pathname + window.location.search,
              y: window.scrollY,
            }),
          );
        } catch {
          /* quota / private-mode — ignore */
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    // Serve cached summary instantly on remount, then refresh in background.
    if (_summaryCache.data) setSummary(_summaryCache.data);
    (async () => {
      try {
        const r = await fetch("/api/admin/confluence/summary", { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        _summaryCache.data = j.data;
        setSummary(j.data);
      } catch (e) {
        if (!_summaryCache.data) setErr(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      setQDebounced(q);
      // Reset to page 0 whenever the search query changes — otherwise
      // a search typed on page 42 would fetch at offset 2100 and miss
      // all results that live on earlier pages.
      setPage(0);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    // Wait for the URL-hydration effect to apply stored state before
    // firing the first fetch — otherwise a fresh mount with "?page=50"
    // in the URL would issue two fetches (defaults + URL values).
    if (!hydrated) return;
    let cancelled = false;

    // Build the API URL so we can key the module-level cache.
    const params = new URLSearchParams();
    if (qDebounced) params.set("q", qDebounced);
    if (fy) params.set("fiscal_year", fy);
    if (pageType) params.set("page_type", pageType);
    if (hasDrawio) params.set("has_drawio", "true");
    if (includeDeep) params.set("include_deep", "true");
    if (showEmpty) params.set("hide_empty", "false");
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(page * PAGE_SIZE));
    const apiUrl = `/api/admin/confluence/pages?${params}`;

    // Serve from module-level cache instantly (back-nav case). This lets
    // the table render without any loading flash. A background fetch still
    // runs to pick up any server-side changes, but visually the page
    // appears frozen — exactly as the user left it.
    const cached = _listCache.get(apiUrl);
    if (cached) {
      setData(cached);
      // Still set loading=true briefly so the status bar shows "loading…"
      // during the background refresh, but the table is already visible.
    }

    (async () => {
      if (!cached) setLoading(true);
      setErr(null);
      try {
        const r = await fetch(apiUrl, { cache: "no-store" });
        const j = await r.json();
        if (!j.success) throw new Error(j.error);
        if (!cancelled) {
          _listCacheSet(apiUrl, j.data);
          setData(j.data);
        }
      } catch (e) {
        if (!cancelled && !cached) setErr(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, qDebounced, fy, pageType, hasDrawio, includeDeep, showEmpty, page]);

  // Scroll restore: once, after the FIRST data load on this mount, jump to
  // the remembered scrollY if its URL matches. The URL match guards against
  // restoring a scroll that belonged to a different filter view.
  useEffect(() => {
    if (scrollRestoredRef.current) return;
    if (loading) return;
    if (!data) return;
    scrollRestoredRef.current = true;
    try {
      const raw = sessionStorage.getItem(SCROLL_STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { url?: string; y?: number };
      const currentUrl = window.location.pathname + window.location.search;
      if (saved.url === currentUrl && typeof saved.y === "number") {
        // Two rAFs to ensure the DOM has painted the table before scrolling.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.scrollTo({ top: saved.y!, behavior: "auto" });
          });
        });
      }
    } catch {
      /* ignore malformed JSON or storage errors */
    }
  }, [loading, data]);

  const total = data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  // Row-group metadata for rowspan-style folding. The backend returns
  // rows strictly sorted by (fiscal_year, project_id, title, app_id), so
  // every sibling of a group is adjacent to its primary within the current
  // page. We walk the rows once and compute each row's `position` ("solo",
  // "first", or "sibling") so sibling rows can hide their project id/name
  // cells and paint an amber binding border to visually tie them to their
  // primary above.
  const groupInfo = useMemo(() => {
    const rows = data?.rows ?? [];
    if (rows.length === 0) {
      return {
        positions: [] as Array<"solo" | "first" | "sibling">,
        isPageContinuation: false,
      };
    }
    const positions: Array<"solo" | "first" | "sibling"> = new Array(rows.length);

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
          for (let j = groupStart; j < i; j++) positions[j] = "solo";
        } else {
          positions[groupStart] = "first";
          for (let j = groupStart + 1; j < i; j++) positions[j] = "sibling";
        }
        groupStart = i;
      }
    }

    return {
      positions,
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
        <select value={fy} onChange={(e) => { setFy(e.target.value); setPage(0); }}>
          <option value="">All fiscal years</option>
          {summary?.by_fy.slice().reverse().map((f) => (
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
        <label
          style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}
          title="Default: show only direct children of each project (matches Confluence tree). Turn on to include depth-3 grandchild pages whose titles got promoted to independent app rows."
        >
          <input
            type="checkbox"
            checked={includeDeep}
            onChange={(e) => {
              setIncludeDeep(e.target.checked);
              setPage(0);
            }}
          />
          Include sub-applications
        </label>
        <label
          style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}
          title="Default: hide project-folder pages with zero attachments on themselves OR any direct child (empty stubs). Turn on to see every scanned page including bare titles like 'FY2526-125 CoC PBI Data Refresh'."
        >
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => {
              setShowEmpty(e.target.checked);
              setPage(0);
            }}
          />
          Show empty stubs
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

      <Pager
        page={page}
        maxPage={maxPage}
        total={total}
        pageSize={PAGE_SIZE}
        loading={loading}
        onPageChange={setPage}
      />

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 70 }}>FY</th>
              <th style={{ width: 110 }}>Project ID</th>
              <th>Project Name</th>
              <th>Applications</th>
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
              const isSibling = position === "sibling";

              // Sibling rows: the FY / Project ID / Project Name cells are
              // empty because they're visually "merged" with the primary row
              // above via the amber left border painted on the project_id
              // cell. The cells remain in DOM to keep column widths stable —
              // we don't fight the table layout engine.
              const bindingBorder = isSibling
                ? "2px solid var(--accent-dim)"
                : undefined;

              // "+N more apps" badge: show after the last row of a group
              // when the backend capped the explosion. The badge row
              // inherits the amber binding border and links to the detail
              // page so the user can see the full app breakdown.
              const isLastInGroup =
                idx === (data?.rows.length ?? 0) - 1 ||
                !groupInfo.positions[idx + 1] ||
                groupInfo.positions[idx + 1] === "solo" ||
                groupInfo.positions[idx + 1] === "first";
              const hiddenApps =
                isLastInGroup && r.project_app_total && r.project_app_total > 10
                  ? r.project_app_total - 10
                  : 0;

              return (<React.Fragment key={r.page_id}>
                <tr>
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
                  {/* Project name — truncated to fit; full name on hover. */}
                  <td style={{ maxWidth: 280, width: 280 }}>
                    {isSibling ? null : (
                      <div
                        style={{
                          maxWidth: "100%",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        <NameCell
                          primary={r.project_name}
                          source={r.project_name_source}
                          fallback={r.page_type === "project" ? r.title : null}
                          pageId={r.page_id}
                        />
                      </div>
                    )}
                  </td>
                  {/* Applications — inline [id] name · [id] name format
                      APP ID → /apps/{id} (CMDB application detail page)
                      APP NAME → /admin/confluence/{page_id}?tab=extracted */}
                  <td style={{ fontSize: 12 }}>
                    {(r.project_apps && r.project_apps.length > 0
                      ? r.project_apps
                      : [{ app_id: r.app_id, app_name: r.app_name, app_in_cmdb: r.app_in_cmdb }]
                    ).map((app, ai) => {
                      const isStdId = app.app_id && /^A\d{5,7}$/.test(app.app_id);
                      return (
                        <React.Fragment key={ai}>
                          {ai > 0 && <span style={{ color: "var(--text-dim)" }}> · </span>}
                          {app.app_id && (
                            isStdId && app.app_in_cmdb ? (
                              <Link
                                href={`/apps/${app.app_id}`}
                                style={{
                                  color: "var(--accent)",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                                title={`View ${app.app_id} in CMDB`}
                              >
                                [{app.app_id}]
                              </Link>
                            ) : (
                              <span
                                style={{
                                  color: "var(--text-muted)",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                              >
                                [{app.app_id}]
                              </span>
                            )
                          )}
                          {app.app_id && " "}
                          <Link
                            href={`/admin/confluence/${r.page_id}?tab=extracted`}
                            style={{ color: "var(--text)" }}
                            title="View extracted applications"
                          >
                            {app.app_name || "—"}
                          </Link>
                        </React.Fragment>
                      );
                    })}
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
                {hiddenApps > 0 && (
                  <tr key={`${r.page_id}-more`}>
                    <td />
                    <td style={{ borderLeft: "2px solid var(--accent-dim)" }} />
                    <td />
                    <td
                      colSpan={5}
                      style={{
                        padding: "4px 16px",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        color: "var(--text-dim)",
                      }}
                    >
                      +{hiddenApps} more apps — see detail page
                    </td>
                  </tr>
                )}
              </React.Fragment>
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

const STRICT_APP_ID_RE = /^A\d{5,7}$/;

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
  // For the app column we ONLY render ids that are (a) strictly AXXXXX-shaped
  // and (b) verified against CMDB ref_application. Unresolved hint tags
  // like "[Robbie IT Service Agent]" and "[PISA]", false-positive substrings
  // like "A250197" extracted from project id "EA250197", and any other
  // non-canonical value collapse to an em-dash. Project ids keep their full
  // rendering because their format is more varied (LI.../FY.../RD.../EA...).
  if (kind === "app" && (!verified || !STRICT_APP_ID_RE.test(id))) {
    return <span style={{ color: "var(--text-dim)" }}>—</span>;
  }
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
  const s = style[source] ?? style.none;
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

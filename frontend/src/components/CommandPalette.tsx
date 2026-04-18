"use client";

/**
 * CommandPalette — global Cmd+K / Ctrl+K / "/" search.
 *
 * Queries /api/search (backend uses PG tsvector + pg_trgm) and renders a
 * grouped result list (apps, projects). Keyboard-driven: ↑/↓ to move,
 * Enter to open, Esc to close.
 *
 * Mounted once in app/layout.tsx so the palette is available from any page.
 * Stores recent searches in localStorage so the empty state has content.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface AppResult {
  app_id: string;
  name: string;
  app_full_name: string | null;
  status: string | null;
  app_classification: string | null;
  score: number;
}

interface ProjectResult {
  project_id: string;
  project_name: string | null;
  status: string | null;
  pm: string | null;
  start_date: string | null;
  score: number;
}

interface EaDocResult {
  page_id: string;
  title: string;
  domain: string;
  doc_type: string;
  page_url: string;
  excerpt: string | null;
  score: number;
}

interface SearchResponse {
  query: string;
  applications: AppResult[];
  projects: ProjectResult[];
  ea_documents: EaDocResult[];
  note?: string;
}

const DOMAIN_LABELS: Record<string, string> = {
  ai: "AI", aa: "App", ta: "Tech", da: "Data", dpp: "Privacy", governance: "Gov",
};
const DOC_TYPE_LABELS: Record<string, string> = {
  standard: "Standard", guideline: "Guideline",
  reference_arch: "Ref Arch", template: "Template",
};

interface RecentItem {
  kind: "app" | "project";
  id: string;
  label: string;
  ts: number;
}

// Static quick-jump destinations. Matched by substring against the query
// terms listed in `keywords`. kind="page" → router.push to the `href`.
interface StaticPage {
  href: string;
  label: string;
  sub: string;
  keywords: string[];
}
const STATIC_PAGES: StaticPage[] = [
  {
    href: "/settings",
    label: "Settings — Architecture Templates",
    sub: "Configure Confluence URLs for BA / AA / TA",
    keywords: ["settings", "setting", "template", "templates", "confluence", "architecture", "ba", "aa", "ta"],
  },
];

const RECENT_KEY = "northstar.recentSearches";
const MAX_RECENT = 8;
const DEBOUNCE_MS = 150;

function loadRecent(): RecentItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentItem[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(items: RecentItem[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(items.slice(0, MAX_RECENT)));
  } catch {
    /* quota — ignore */
  }
}

export function CommandPalette() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [recent, setRecent] = useState<RecentItem[]>([]);

  // --- Global keybinding: Cmd+K / Ctrl+K / "/" ---
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      const isSlash =
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        // Don't swallow "/" while typing in an input/textarea
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement);
      if (isCmdK || isSlash) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // --- Focus input on open, reset state on close ---
  useEffect(() => {
    if (open) {
      setRecent(loadRecent());
      // Defer focus until the dialog is actually rendered
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      setQ("");
      setQDebounced("");
      setData(null);
      setErr(null);
      setSelectedIdx(0);
    }
  }, [open]);

  // --- Debounce the search query ---
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // --- Fetch results ---
  useEffect(() => {
    if (!open || qDebounced.length < 2) {
      setData(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(
          `/api/search?q=${encodeURIComponent(qDebounced)}`,
          { cache: "no-store" }
        );
        if (!res.ok) throw new Error(`${res.status}`);
        const body = await res.json();
        if (cancelled) return;
        if (!body.success) {
          setErr(body.error || "Search failed");
          return;
        }
        setData(body.data as SearchResponse);
        setSelectedIdx(0);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qDebounced, open]);

  // --- Static pages matched by query substring (shown first) ---
  const matchedPages = useMemo(() => {
    const query = qDebounced.trim().toLowerCase();
    if (query.length < 2) return [];
    return STATIC_PAGES.filter((p) =>
      p.keywords.some((k) => k.includes(query) || query.includes(k)) ||
      p.label.toLowerCase().includes(query),
    );
  }, [qDebounced]);

  // --- Flat list of selectable items (for keyboard nav) ---
  const items = useMemo(() => {
    const out: Array<{
      kind: "app" | "project" | "ea_doc" | "page";
      id: string;
      label: string;
      sub: string;
      url?: string;
      href?: string;
    }> = [];
    // Pages first — they're quick-jumps.
    for (const p of matchedPages) {
      out.push({ kind: "page", id: p.href, label: p.label, sub: p.sub, href: p.href });
    }
    if (data) {
      for (const a of data.applications) {
        out.push({
          kind: "app",
          id: a.app_id,
          label: a.name || a.app_id,
          sub: a.app_full_name || a.status || "",
        });
      }
      for (const p of data.projects) {
        out.push({
          kind: "project",
          id: p.project_id,
          label: p.project_name || p.project_id,
          sub: [p.pm, p.status].filter(Boolean).join(" · "),
        });
      }
      for (const d of data.ea_documents || []) {
        out.push({
          kind: "ea_doc",
          id: d.page_id,
          label: d.title,
          sub: `${DOMAIN_LABELS[d.domain] || d.domain} · ${DOC_TYPE_LABELS[d.doc_type] || d.doc_type}`,
          url: d.page_url,
        });
      }
    }
    return out;
  }, [data, matchedPages]);

  // --- Navigate on select ---
  const onSelect = useCallback(
    (item: {
      kind: "app" | "project" | "ea_doc" | "page";
      id: string;
      label: string;
      url?: string;
      href?: string;
    }) => {
      // Quick-jump pages — internal navigation, no recent persistence
      if (item.kind === "page" && item.href) {
        setOpen(false);
        router.push(item.href);
        return;
      }
      // EA docs open Confluence in a new tab — don't persist as recent
      if (item.kind === "ea_doc" && item.url) {
        window.open(item.url, "_blank", "noopener");
        setOpen(false);
        return;
      }
      // persist recent
      const next: RecentItem[] = [
        { kind: item.kind as "app" | "project", id: item.id, label: item.label, ts: Date.now() },
        ...recent.filter((r) => !(r.kind === item.kind && r.id === item.id)),
      ].slice(0, MAX_RECENT);
      saveRecent(next);
      setOpen(false);
      if (item.kind === "app") {
        router.push(`/apps/${encodeURIComponent(item.id)}`);
      } else {
        // No project detail page yet — fall back to admin projects list
        router.push("/admin/projects");
      }
    },
    [recent, router]
  );

  // --- Keyboard nav inside the palette ---
  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((i) => Math.min(i + 1, Math.max(0, items.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (items[selectedIdx]) {
        onSelect(items[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  if (!open) {
    return null;
  }

  const showRecent = items.length === 0 && qDebounced.length < 2 && recent.length > 0;
  const showShortHint = items.length === 0 && qDebounced.length < 2 && recent.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        // Click on backdrop closes
        if (e.target === e.currentTarget) setOpen(false);
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(4, 6, 10, 0.72)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "12vh",
      }}
    >
      <div
        style={{
          width: "min(640px, 92vw)",
          background: "var(--surface)",
          border: "1px solid var(--border-strong)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
          fontFamily: "var(--font-body)",
        }}
      >
        {/* Input row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: "14px 18px",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-elevated)",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--accent)",
              fontSize: 13,
              marginRight: 12,
            }}
          >
            {">"}
          </span>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder="Search applications, projects, standards…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontSize: 15,
              fontFamily: "var(--font-body)",
            }}
          />
          {loading && (
            <span style={{ color: "var(--text-dim)", fontSize: 11, marginLeft: 12 }}>
              searching…
            </span>
          )}
          <kbd
            style={{
              marginLeft: 12,
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {err && (
            <div style={{ padding: 16, color: "var(--error)", fontSize: 12 }}>{err}</div>
          )}

          {showShortHint && (
            <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 13 }}>
              Type at least 2 characters. Try an app id (e.g.{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>A003530</code>), an app name, or a
              project id (e.g.{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>LI2500073</code>).
            </div>
          )}

          {showRecent && (
            <ResultGroup label="Recent">
              {recent.map((r, idx) => (
                <ResultRow
                  key={`${r.kind}-${r.id}`}
                  selected={selectedIdx === idx}
                  onClick={() => onSelect(r)}
                  badge={r.kind === "app" ? "APP" : "PROJ"}
                  label={r.label}
                  sub={r.id}
                  mono
                />
              ))}
            </ResultGroup>
          )}

          {data && items.length === 0 && qDebounced.length >= 2 && !loading && (
            <div style={{ padding: 24, color: "var(--text-dim)", fontSize: 13 }}>
              No results for <code style={{ fontFamily: "var(--font-mono)" }}>{qDebounced}</code>.
            </div>
          )}

          {matchedPages.length > 0 && (
            <ResultGroup label="Pages">
              {matchedPages.map((p, i) => {
                const idxFlat = i;
                return (
                  <ResultRow
                    key={`page-${p.href}`}
                    selected={selectedIdx === idxFlat}
                    onClick={() =>
                      onSelect({ kind: "page", id: p.href, label: p.label, href: p.href })
                    }
                    badge="NAV"
                    label={p.label}
                    sub={p.sub}
                    mono={false}
                  />
                );
              })}
            </ResultGroup>
          )}

          {data && data.applications.length > 0 && (
            <ResultGroup label={`Applications (${data.applications.length})`}>
              {data.applications.map((a, i) => {
                const idxFlat = matchedPages.length + i;
                return (
                  <ResultRow
                    key={`app-${a.app_id}`}
                    selected={selectedIdx === idxFlat}
                    onClick={() =>
                      onSelect({ kind: "app", id: a.app_id, label: a.name || a.app_id })
                    }
                    badge="APP"
                    label={a.name || a.app_id}
                    sub={a.app_full_name || a.status || ""}
                    mono={false}
                    id={a.app_id}
                  />
                );
              })}
            </ResultGroup>
          )}

          {data && data.projects.length > 0 && (
            <ResultGroup label={`Projects (${data.projects.length})`}>
              {data.projects.map((p, i) => {
                const idxFlat = matchedPages.length + (data?.applications.length || 0) + i;
                return (
                  <ResultRow
                    key={`proj-${p.project_id}`}
                    selected={selectedIdx === idxFlat}
                    onClick={() =>
                      onSelect({
                        kind: "project",
                        id: p.project_id,
                        label: p.project_name || p.project_id,
                      })
                    }
                    badge="PROJ"
                    label={p.project_name || p.project_id}
                    sub={[p.pm, p.status].filter(Boolean).join(" · ")}
                    mono={false}
                    id={p.project_id}
                  />
                );
              })}
            </ResultGroup>
          )}

          {data && (data.ea_documents || []).length > 0 && (
            <ResultGroup label={`EA Standards & Guidelines (${data.ea_documents.length})`}>
              {data.ea_documents.map((d, i) => {
                const idxFlat = matchedPages.length + (data?.applications.length || 0) + (data?.projects.length || 0) + i;
                return (
                  <ResultRow
                    key={`ea-${d.page_id}`}
                    selected={selectedIdx === idxFlat}
                    onClick={() =>
                      onSelect({
                        kind: "ea_doc",
                        id: d.page_id,
                        label: d.title,
                        url: d.page_url,
                      })
                    }
                    badge="EA"
                    label={d.title}
                    sub={`${DOMAIN_LABELS[d.domain] || d.domain} · ${DOC_TYPE_LABELS[d.doc_type] || d.doc_type}`}
                    mono={false}
                  />
                );
              })}
            </ResultGroup>
          )}
        </div>

        {/* Footer hints */}
        <div
          style={{
            borderTop: "1px solid var(--border)",
            padding: "8px 14px",
            fontSize: 10,
            color: "var(--text-dim)",
            display: "flex",
            gap: 16,
            background: "var(--bg-elevated)",
          }}
        >
          <span>
            <kbd style={kbdStyle}>↑</kbd> <kbd style={kbdStyle}>↓</kbd> navigate
          </span>
          <span>
            <kbd style={kbdStyle}>Enter</kbd> open
          </span>
          <span>
            <kbd style={kbdStyle}>/</kbd> open anywhere
          </span>
          <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>
            NorthStar search
          </span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "0 5px",
  border: "1px solid var(--border-strong)",
  borderRadius: "var(--radius-sm)",
  fontFamily: "var(--font-mono)",
  color: "var(--text-muted)",
  fontSize: 9,
};

function ResultGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          padding: "10px 18px 6px",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ResultRow({
  selected,
  onClick,
  badge,
  label,
  sub,
  id,
}: {
  selected: boolean;
  onClick: () => void;
  badge: string;
  label: string;
  sub: string;
  mono?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "10px 18px",
        background: selected ? "var(--surface-hover)" : "transparent",
        border: "none",
        borderLeft: selected ? "2px solid var(--accent)" : "2px solid transparent",
        textAlign: "left",
        cursor: "pointer",
        color: "var(--text)",
      }}
    >
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: 0.6,
          padding: "2px 6px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border-strong)",
          color: "var(--text-muted)",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-mono)",
          minWidth: 38,
          textAlign: "center",
        }}
      >
        {badge}
      </span>
      <span style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-body)",
            color: "var(--text)",
          }}
        >
          {label}
        </span>
        {sub && (
          <span
            style={{
              color: "var(--text-muted)",
              fontSize: 11,
              marginLeft: 10,
            }}
          >
            {sub}
          </span>
        )}
      </span>
      {id && (
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-dim)",
          }}
        >
          {id}
        </code>
      )}
    </button>
  );
}

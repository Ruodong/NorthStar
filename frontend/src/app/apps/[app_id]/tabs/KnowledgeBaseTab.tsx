"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";
import { useTabFetch } from "../_shared/useTabFetch";

interface KBPage {
  page_id: string;
  title: string;
  excerpt: string;
  last_modified: string;
  updater: string;
  page_url: string;
}

interface KBSpace {
  space_key: string;
  space_name: string;
  page_count: number;
  pages: KBPage[];
}

interface KBResponse {
  total: number;
  app_name: string;
  spaces: KBSpace[];
}

export function KnowledgeBaseTab({ appId }: { appId: string }) {
  // Preserves the 15-second timeout the hand-rolled version had (the
  // Confluence CQL backend occasionally stalls). useTabFetch converts
  // AbortError to silent no-op (matches previous behavior of treating
  // abort as "stale request, ignore").
  const { data, loading, err: rawErr } = useTabFetch<KBResponse>(
    appId ? `/api/graph/nodes/${encodeURIComponent(appId)}/knowledge` : null,
    [appId],
    { timeoutMs: 15_000 },
  );
  // Translate generic err string to the original user-friendly timeout copy.
  const err =
    rawErr === "AbortError"
      ? "Confluence search timed out — the server may be unreachable."
      : rawErr;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  // Auto-expand top 2 spaces on first load (preserves previous behavior).
  useEffect(() => {
    if (!data) return;
    const topKeys = data.spaces.slice(0, 2).map((s) => s.space_key);
    setExpanded(new Set(topKeys));
  }, [data]);

  if (loading) {
    return (
      <Panel title="Knowledge Base">
        <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 20, textAlign: "center" }}>
          Searching Confluence...
        </div>
      </Panel>
    );
  }
  if (err) {
    return (
      <Panel title="Knowledge Base">
        <div style={{ color: "var(--error)", fontSize: 13 }}>Failed: {err}</div>
      </Panel>
    );
  }
  if (!data || data.total === 0) {
    return (
      <Panel title="Knowledge Base — Cross-Space References">
        <EmptyState>No pages found mentioning this application in other Confluence spaces.</EmptyState>
      </Panel>
    );
  }

  const lowerFilter = filter.toLowerCase();
  const filtered = data.spaces
    .map((s) => ({
      ...s,
      pages: s.pages.filter(
        (p) =>
          !lowerFilter ||
          p.title.toLowerCase().includes(lowerFilter) ||
          p.updater.toLowerCase().includes(lowerFilter)
      ),
    }))
    .filter((s) => s.pages.length > 0);

  const INITIAL_SPACES = 5;
  const visible = showAll ? filtered : filtered.slice(0, INITIAL_SPACES);
  const remaining = filtered.length - INITIAL_SPACES;

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const totalSpaces = data.spaces.length;

  return (
    <Panel
      title={`Knowledge Base — ${data.total} pages across ${totalSpaces} spaces mention "${data.app_name}"`}
    >
      {/* Filter bar */}
      <div style={{ marginBottom: 16, display: "flex", gap: 12, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter by title or author..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{
            flex: 1,
            maxWidth: 360,
            padding: "6px 12px",
            fontSize: 12,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-sm)",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {filtered.reduce((a, s) => a + s.pages.length, 0)} results
        </span>
      </div>

      {/* Space groups */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visible.map((space) => {
          const isOpen = expanded.has(space.space_key);
          return (
            <div
              key={space.space_key}
              style={{
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)",
                overflow: "hidden",
              }}
            >
              {/* Space header — clickable */}
              <div
                onClick={() => toggle(space.space_key)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  background: "var(--bg-elevated)",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", width: 12 }}>
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>
                    {space.space_name}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-dim)",
                      padding: "1px 6px",
                      background: "var(--surface)",
                      borderRadius: "var(--radius-sm)",
                    }}
                  >
                    {space.space_key}
                  </span>
                </div>
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
                  {space.pages.length} {space.pages.length === 1 ? "page" : "pages"}
                </span>
              </div>

              {/* Pages list */}
              {isOpen && (
                <div>
                  {space.pages.map((pg) => (
                    <div
                      key={pg.page_id}
                      style={{
                        padding: "8px 14px 8px 34px",
                        borderTop: "1px solid var(--border)",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <a
                          href={pg.page_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--accent)",
                            textDecoration: "none",
                            flex: 1,
                            marginRight: 16,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          title={pg.title}
                        >
                          {pg.title}
                          <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.5 }}>↗</span>
                        </a>
                        <div
                          style={{
                            display: "flex",
                            gap: 16,
                            flexShrink: 0,
                            color: "var(--text-dim)",
                            fontSize: 11,
                          }}
                        >
                          <span style={{ fontFamily: "var(--font-mono)", width: 80 }}>
                            {pg.last_modified}
                          </span>
                          <span
                            style={{
                              width: 120,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={pg.updater}
                          >
                            {pg.updater}
                          </span>
                        </div>
                      </div>
                      {pg.excerpt && (
                        <div style={{
                          marginTop: 4,
                          fontSize: 11,
                          lineHeight: 1.5,
                          color: "var(--text-dim)",
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical" as const,
                        }}>
                          {pg.excerpt}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Load more */}
      {!showAll && remaining > 0 && (
        <div style={{ textAlign: "center", marginTop: 16 }}>
          <button
            onClick={() => setShowAll(true)}
            style={{
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              padding: "8px 24px",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Load more spaces ({remaining} remaining)
          </button>
        </div>
      )}
    </Panel>
  );
}

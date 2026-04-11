"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

// -----------------------------------------------------------------------------
// Types — match backend/app/routers/whats_new.py
// -----------------------------------------------------------------------------
interface DiffRow {
  id: number;
  loader_run_id: string | null;
  detected_at: string;
  diff_type: string;
  entity_type: string;
  entity_id: string;
  entity_name: string | null;
  fiscal_year: string | null;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
}

interface FeedResponse {
  total: number;
  rows: DiffRow[];
}

interface SummaryResponse {
  since: string;
  total: number;
  by_type: Record<string, number>;
  latest_diff_at: string | null;
}

const DIFF_LABELS: Record<string, string> = {
  app_added: "New app",
  app_status_changed: "Status changed",
  app_description_changed: "Description changed",
  app_name_changed: "Name changed",
  app_removed: "App removed",
  integration_added: "New integration",
  integration_removed: "Integration removed",
};

const DIFF_COLORS: Record<string, string> = {
  app_added: "var(--status-new)",
  app_status_changed: "var(--status-change)",
  app_description_changed: "var(--status-keep)",
  app_name_changed: "var(--status-keep)",
  app_removed: "var(--status-sunset)",
  integration_added: "var(--status-new)",
  integration_removed: "var(--status-sunset)",
};

const FILTER_TYPES: Array<{ value: string; label: string }> = [
  { value: "", label: "All" },
  { value: "app_added", label: "New" },
  { value: "app_status_changed", label: "Status" },
  { value: "app_description_changed", label: "Description" },
  { value: "app_name_changed", label: "Name" },
];

const PAGE_SIZE = 50;

export default function WhatsNewPage() {
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [feed, setFeed] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [diffType, setDiffType] = useState<string>("");
  const [days, setDays] = useState<number>(90);
  const [page, setPage] = useState<number>(0);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [summaryRes, feedRes] = await Promise.all([
        fetch(`/api/whats-new/summary?days=${days}`, { cache: "no-store" }).then((r) => r.json()),
        fetch(
          `/api/whats-new/feed?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}&days=${days}${
            diffType ? `&diff_type=${encodeURIComponent(diffType)}` : ""
          }`,
          { cache: "no-store" }
        ).then((r) => r.json()),
      ]);
      if (!summaryRes.success) throw new Error(summaryRes.error || "summary failed");
      if (!feedRes.success) throw new Error(feedRes.error || "feed failed");
      setSummary(summaryRes.data);
      setFeed(feedRes.data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [diffType, days, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Group diffs by day
  const grouped = useMemo(() => {
    if (!feed) return new Map<string, DiffRow[]>();
    const m = new Map<string, DiffRow[]>();
    for (const row of feed.rows) {
      const day = row.detected_at.slice(0, 10); // YYYY-MM-DD
      const list = m.get(day) ?? [];
      list.push(row);
      m.set(day, list);
    }
    return m;
  }, [feed]);

  const hasNext = feed ? (page + 1) * PAGE_SIZE < feed.total : false;

  return (
    <div>
      {/* ---------------- Header ---------------- */}
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 600,
            marginBottom: 6,
          }}
        >
          What&apos;s New
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 760 }}>
          Application and integration changes detected on each loader run. Grouped by day, newest
          first.
        </p>
      </div>

      {/* ---------------- Summary cards ---------------- */}
      {summary && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <SummaryCard label={`Total (last ${days}d)`} value={summary.total} accent />
          <SummaryCard label="New apps" value={summary.by_type.app_added || 0} />
          <SummaryCard label="Status changes" value={summary.by_type.app_status_changed || 0} />
          <SummaryCard
            label="Description changes"
            value={summary.by_type.app_description_changed || 0}
          />
          <SummaryCard
            label="Latest diff"
            textValue={
              summary.latest_diff_at
                ? new Date(summary.latest_diff_at).toISOString().slice(0, 16).replace("T", " ")
                : "—"
            }
          />
        </div>
      )}

      {/* ---------------- Filters ---------------- */}
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "center",
          padding: 12,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {FILTER_TYPES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setDiffType(f.value);
                setPage(0);
              }}
              style={{
                background: diffType === f.value ? "var(--accent)" : "transparent",
                color: diffType === f.value ? "#000" : "var(--text-muted)",
                border: `1px solid ${diffType === f.value ? "var(--accent)" : "var(--border-strong)"}`,
                padding: "6px 14px",
                borderRadius: "var(--radius-md)",
                fontSize: 12,
                fontWeight: diffType === f.value ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Window:{" "}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setPage(0);
            }}
            style={{
              marginLeft: 6,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              padding: "6px 10px",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>
        {loading && <span style={{ color: "var(--text-dim)", fontSize: 12 }}>loading…</span>}
        {err && <span style={{ color: "var(--error)", fontSize: 12 }}>{err}</span>}
      </div>

      {/* ---------------- Feed ---------------- */}
      {!loading && feed && feed.rows.length === 0 && (
        <div
          style={{
            padding: 60,
            textAlign: "center",
            color: "var(--text-dim)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          No changes in this window.
          {diffType && " Try clearing the filter."}
        </div>
      )}

      {Array.from(grouped.entries()).map(([day, rows]) => (
        <DayGroup key={day} day={day} rows={rows} />
      ))}

      {/* ---------------- Pagination ---------------- */}
      {feed && (feed.total > PAGE_SIZE || page > 0) && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            marginTop: 24,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <button
            type="button"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            style={{
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: page === 0 ? "var(--text-dim)" : "var(--text)",
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              cursor: page === 0 ? "not-allowed" : "pointer",
            }}
          >
            ← Prev
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, feed.total)} of {feed.total}
          </span>
          <button
            type="button"
            disabled={!hasNext}
            onClick={() => setPage((p) => p + 1)}
            style={{
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: hasNext ? "var(--text)" : "var(--text-dim)",
              padding: "6px 14px",
              borderRadius: "var(--radius-md)",
              cursor: hasNext ? "pointer" : "not-allowed",
            }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Subcomponents
// -----------------------------------------------------------------------------
function SummaryCard({
  label,
  value,
  textValue,
  accent,
}: {
  label: string;
  value?: number;
  textValue?: string;
  accent?: boolean;
}) {
  return (
    <div
      style={{
        padding: 16,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: accent ? "2px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {value !== undefined ? (
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 600,
            fontVariantNumeric: "tabular-nums",
            color: accent ? "var(--accent)" : "var(--text)",
          }}
        >
          {value.toLocaleString()}
        </div>
      ) : (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            color: "var(--text-muted)",
          }}
        >
          {textValue}
        </div>
      )}
    </div>
  );
}

function DayGroup({ day, rows }: { day: string; rows: DiffRow[] }) {
  const formatted = new Date(day + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 8,
          paddingBottom: 4,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {formatted}{" "}
        <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>({rows.length})</span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {rows.map((r) => (
          <DiffRowItem key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}

function DiffRowItem({ row }: { row: DiffRow }) {
  const color = DIFF_COLORS[row.diff_type] || "var(--text-dim)";
  const label = DIFF_LABELS[row.diff_type] || row.diff_type;
  const time = new Date(row.detected_at).toISOString().slice(11, 16);

  let summary: React.ReactNode = null;
  if (row.diff_type === "app_status_changed" && row.old_value && row.new_value) {
    summary = (
      <>
        <code style={{ fontFamily: "var(--font-mono)" }}>{String(row.old_value.status ?? "—")}</code>{" "}
        → <code style={{ fontFamily: "var(--font-mono)" }}>{String(row.new_value.status ?? "—")}</code>
      </>
    );
  } else if (row.diff_type === "app_added" && row.new_value) {
    summary = (
      <span style={{ color: "var(--text-dim)" }}>
        status: {String(row.new_value.status ?? "—")}
      </span>
    );
  } else if (row.diff_type === "app_name_changed" && row.old_value && row.new_value) {
    summary = (
      <>
        <code style={{ fontFamily: "var(--font-mono)" }}>{String(row.old_value.name ?? "—")}</code>{" "}
        → <code style={{ fontFamily: "var(--font-mono)" }}>{String(row.new_value.name ?? "—")}</code>
      </>
    );
  } else if (row.diff_type === "app_description_changed") {
    summary = <span style={{ color: "var(--text-dim)" }}>description updated</span>;
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `2px solid ${color}`,
        borderRadius: "var(--radius-md)",
        fontSize: 13,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-dim)",
          minWidth: 36,
        }}
      >
        {time}
      </span>
      <span
        style={{
          fontSize: 10,
          padding: "2px 8px",
          background: `color-mix(in srgb, ${color} 14%, transparent)`,
          color,
          borderRadius: "var(--radius-sm)",
          textTransform: "uppercase",
          letterSpacing: 0.6,
          fontWeight: 600,
          minWidth: 100,
          textAlign: "center",
        }}
      >
        {label}
      </span>
      {row.entity_type === "application" ? (
        <Link
          href={`/apps/${encodeURIComponent(row.entity_id)}`}
          style={{
            color: "var(--text)",
            textDecoration: "none",
            flex: "0 0 auto",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          {row.entity_id}
        </Link>
      ) : (
        <code style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.entity_id}</code>
      )}
      <span style={{ color: "var(--text-muted)", flex: 1, minWidth: 0 }}>
        {row.entity_name || "—"}
      </span>
      {summary && (
        <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{summary}</span>
      )}
    </div>
  );
}

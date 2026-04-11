"use client";

/**
 * Pager — reusable pagination control for admin list tables.
 *
 * Replaces the old Prev / "N / M" / Next triplet with:
 *   • First · Prev
 *   • numbered page buttons (windowed around current, ellipses for gaps)
 *   • Next · Last
 *   • "Go to page" input on the right for direct jump
 *
 * Designed for server-paginated lists where the parent owns `page` state
 * and refetches on change. See admin/{confluence,applications,projects}
 * for usage.
 */
import { KeyboardEvent, useEffect, useState } from "react";

interface PagerProps {
  /** Current 0-indexed page. */
  page: number;
  /** Highest valid 0-indexed page (Math.max(0, ceil(total/pageSize) - 1)). */
  maxPage: number;
  /** Total row count across all pages (shown in the summary). */
  total: number;
  /** Rows per page — used to compute "showing X–Y of N". */
  pageSize: number;
  /** Parent callback to change page. Receives the new 0-indexed page. */
  onPageChange: (newPage: number) => void;
  /** When true, all controls are disabled (prevents race during fetch). */
  loading?: boolean;
  /** How many numbered buttons to show around the current page (default 2). */
  siblingCount?: number;
}

export function Pager({
  page,
  maxPage,
  total,
  pageSize,
  onPageChange,
  loading = false,
  siblingCount = 2,
}: PagerProps) {
  // "Go to page" input stays in sync with the current page when not focused
  const [jumpValue, setJumpValue] = useState<string>(String(page + 1));
  useEffect(() => {
    setJumpValue(String(page + 1));
  }, [page]);

  // If there's only one page (or none), render a stripped-down summary row
  if (maxPage <= 0) {
    return (
      <div style={rowStyle}>
        <span style={summaryStyle}>
          {total === 0 ? "No results" : `${total.toLocaleString()} result${total === 1 ? "" : "s"}`}
        </span>
      </div>
    );
  }

  const start = page * pageSize + 1;
  const end = Math.min(total, (page + 1) * pageSize);
  const pageNumbers = computePageNumbers(page, maxPage, siblingCount);

  const go = (target: number) => {
    if (loading) return;
    const clamped = Math.max(0, Math.min(maxPage, target));
    if (clamped !== page) onPageChange(clamped);
  };

  const commitJump = () => {
    const n = Number.parseInt(jumpValue, 10);
    if (Number.isNaN(n)) {
      setJumpValue(String(page + 1));
      return;
    }
    go(n - 1);
  };

  const onJumpKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commitJump();
    }
  };

  return (
    <div style={rowStyle}>
      <span style={summaryStyle}>
        Showing{" "}
        <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {start.toLocaleString()}–{end.toLocaleString()}
        </strong>{" "}
        of{" "}
        <strong style={{ color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
          {total.toLocaleString()}
        </strong>
      </span>

      <div style={{ flex: 1 }} />

      <PagerButton disabled={page === 0 || loading} onClick={() => go(0)} ariaLabel="First page">
        ⟨⟨
      </PagerButton>
      <PagerButton
        disabled={page === 0 || loading}
        onClick={() => go(page - 1)}
        ariaLabel="Previous page"
      >
        ⟨
      </PagerButton>

      {pageNumbers.map((n, i) =>
        n === "…" ? (
          <span
            key={`gap-${i}`}
            style={{
              color: "var(--text-dim)",
              padding: "0 6px",
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              userSelect: "none",
            }}
          >
            …
          </span>
        ) : (
          <PagerButton
            key={`p-${n}`}
            disabled={loading}
            onClick={() => go((n as number) - 1)}
            active={page + 1 === n}
            ariaLabel={`Page ${n}`}
          >
            {n}
          </PagerButton>
        )
      )}

      <PagerButton
        disabled={page >= maxPage || loading}
        onClick={() => go(page + 1)}
        ariaLabel="Next page"
      >
        ⟩
      </PagerButton>
      <PagerButton
        disabled={page >= maxPage || loading}
        onClick={() => go(maxPage)}
        ariaLabel="Last page"
      >
        ⟩⟩
      </PagerButton>

      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          marginLeft: 14,
          paddingLeft: 14,
          borderLeft: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        Go to
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value.replace(/[^0-9]/g, ""))}
          onBlur={commitJump}
          onKeyDown={onJumpKeyDown}
          disabled={loading}
          style={{
            width: 56,
            background: "var(--bg-elevated)",
            border: "1px solid var(--border-strong)",
            borderRadius: "var(--radius-md)",
            color: "var(--text)",
            padding: "5px 8px",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            textAlign: "center",
            fontVariantNumeric: "tabular-nums",
            outline: "none",
          }}
          aria-label="Go to page"
        />
        <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
          / {maxPage + 1}
        </span>
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/**
 * Compute the windowed list of page numbers to render, with "…" gaps.
 *
 * Example (current=7, max=20, siblings=2):
 *   [1, "…", 5, 6, 7, 8, 9, "…", 21]
 *
 * Always includes the first and last page. siblingCount controls how many
 * pages on each side of the current page are shown.
 */
function computePageNumbers(
  page: number,
  maxPage: number,
  siblingCount: number
): Array<number | "…"> {
  const current = page + 1; // 1-indexed for display
  const last = maxPage + 1;

  // Small page count: show everything
  if (last <= siblingCount * 2 + 5) {
    return Array.from({ length: last }, (_, i) => i + 1);
  }

  const siblingStart = Math.max(current - siblingCount, 2);
  const siblingEnd = Math.min(current + siblingCount, last - 1);

  const showLeftGap = siblingStart > 2;
  const showRightGap = siblingEnd < last - 1;

  const middle: Array<number | "…"> = [];
  for (let i = siblingStart; i <= siblingEnd; i++) middle.push(i);

  return [
    1,
    ...(showLeftGap ? (["…"] as const) : []),
    ...middle,
    ...(showRightGap ? (["…"] as const) : []),
    last,
  ];
}

// -----------------------------------------------------------------------------
// Styles
// -----------------------------------------------------------------------------

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginTop: 14,
  flexWrap: "wrap",
};

const summaryStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  fontFamily: "var(--font-body)",
  marginRight: 12,
};

function PagerButton({
  children,
  onClick,
  disabled,
  active,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-current={active ? "page" : undefined}
      style={{
        minWidth: 32,
        height: 32,
        padding: "0 10px",
        background: active ? "var(--accent)" : "transparent",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-md)",
        color: active ? "#000" : disabled ? "var(--text-dim)" : "var(--text)",
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        cursor: disabled ? "not-allowed" : "pointer",
        fontVariantNumeric: "tabular-nums",
        transition: "border-color var(--t-hover) var(--ease), background var(--t-hover) var(--ease)",
      }}
      onMouseOver={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.borderColor = "var(--accent)";
        }
      }}
      onMouseOut={(e) => {
        if (!disabled && !active) {
          e.currentTarget.style.borderColor = "var(--border-strong)";
        }
      }}
    >
      {children}
    </button>
  );
}

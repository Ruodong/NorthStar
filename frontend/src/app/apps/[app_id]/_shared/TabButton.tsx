import React from "react";
import type { Tab } from "./types";

// App-Detail-shared TabButton. Currently consumed only by AppDetailClient
// (the orchestrator). Lives in _shared/ from the start because every
// future entity detail page (/projects/[id], /capabilities/[id]) will use
// the same component pattern.
//
// CountBadge hide rule (per DESIGN.md PR 1 Component Primitives):
//   count == null || count === 0  →  hide

export function TabButton({
  current,
  value,
  onClick,
  count,
  children,
}: {
  current: Tab;
  value: Tab;
  onClick: (t: Tab) => void;
  count?: number;
  children: React.ReactNode;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      onClick={() => onClick(value)}
      style={{
        background: "transparent",
        border: "none",
        color: active ? "var(--text)" : "var(--text-muted)",
        padding: "10px 16px",
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        borderBottom: active
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        marginBottom: -1,
      }}
    >
      {children}
      {count != null && count > 0 && (
        <span
          style={{
            marginLeft: 6,
            fontSize: 11,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

import React from "react";
import type { Tab } from "./types";

// App-Detail-shared TabButton. Consumed by AppDetailClient's tablist.
// The parent manages keyboard navigation + roving tabindex; this button
// renders the visual affordance + ARIA properties (role="tab",
// aria-selected, aria-controls, id).
//
// CountBadge hide rule (DESIGN.md § Component Primitives):
//   count == null || count === 0  →  hide

export interface TabButtonProps {
  value: Tab;
  selected: boolean;
  onActivate: (t: Tab) => void;
  count?: number;
  children: React.ReactNode;
  /** 0 when selected (only one tabstop per tablist), -1 otherwise. */
  tabIndex: 0 | -1;
  /** Stable id of the associated tabpanel; set via aria-controls. */
  panelId: string;
  /** Stable id of this tab; set via id (for aria-labelledby on panels). */
  tabId: string;
  /** Parent supplies a single onKeyDown for arrow-key navigation. */
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  /** Parent assigns a ref so it can focus the right tab on arrow-key. */
  buttonRef?: (el: HTMLButtonElement | null) => void;
}

export function TabButton({
  value,
  selected,
  onActivate,
  count,
  children,
  tabIndex,
  panelId,
  tabId,
  onKeyDown,
  buttonRef,
}: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={tabIndex}
      ref={buttonRef}
      onClick={() => onActivate(value)}
      onKeyDown={onKeyDown}
      style={{
        background: "transparent",
        border: "none",
        color: selected ? "var(--text)" : "var(--text-muted)",
        // Tighter horizontal padding so all 9 tabs fit on one line at
        // 1440 without overflow. Vertical padding keeps the original
        // feel.
        padding: "10px 8px",
        fontSize: 13,
        fontWeight: selected ? 600 : 400,
        cursor: "pointer",
        borderBottom: selected
          ? "2px solid var(--accent)"
          : "2px solid transparent",
        marginBottom: -1,
        fontFamily: "var(--font-body)",
        // Keep every tab on a single line so the baseline stays even
        // across the row. Multi-word labels ("Impact Analysis",
        // "Knowledge Base") otherwise wrap and misalign with single-word
        // neighbors. NO scrollbar fallback — the row MUST fit.
        whiteSpace: "nowrap",
        flexShrink: 0,
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

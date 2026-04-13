// styles.ts — global shared inline style constants for NorthStar
// Extracts the most repeated patterns across the frontend to DRY constants.
// Design system: DESIGN.md (Orbital Ops), globals.css custom properties.

import type { CSSProperties } from "react";

// ---------------------------------------------------------------------------
// Table styles — the most repeated patterns across the codebase
// ---------------------------------------------------------------------------

/** Table header row: uppercase mono labels (used in ~20 tables) */
export const tableHeadRow: CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  textTransform: "uppercase",
  letterSpacing: 0.6,
  fontFamily: "var(--font-mono)",
  textAlign: "left",
};

/** Standard table cell padding */
export const cellPad: CSSProperties = {
  padding: "6px 8px",
};

/** Wider table cell padding (used in CMDB/detail tables) */
export const cellPadWide: CSSProperties = {
  padding: "8px 12px",
};

/** Standard table border row */
export const tableRow: CSSProperties = {
  fontSize: 12,
  borderTop: "1px solid var(--border)",
};

/** Table header cell with bottom border */
export const tableHeadCell: CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid var(--border)",
};

// ---------------------------------------------------------------------------
// Typography styles
// ---------------------------------------------------------------------------

/** Section label: uppercase, tiny, spaced */
export const sectionLabel: CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
  letterSpacing: 0.6,
  textTransform: "uppercase",
  fontFamily: "var(--font-mono)",
  marginBottom: 6,
};

/** Panel header: uppercase, small, muted */
export const panelHeader: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: 0.7,
  color: "var(--text-muted)",
  marginBottom: 10,
};

/** Mono-spaced muted text (IDs, metadata) */
export const monoMuted: CSSProperties = {
  fontFamily: "var(--font-mono)",
  color: "var(--text-muted)",
};

/** Mono font only (no color override) */
export const mono: CSSProperties = {
  fontFamily: "var(--font-mono)",
};

/** Mono + right-aligned for numeric columns */
export const monoCellRight: CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  textAlign: "right",
};

/** Small dim text for metadata labels */
export const smallDim: CSSProperties = {
  fontSize: 10,
  color: "var(--text-dim)",
};

/** Small muted inline ID display */
export const inlineId: CSSProperties = {
  marginLeft: 6,
  fontSize: 10,
  color: "var(--text-dim)",
  fontFamily: "var(--font-mono)",
};

// ---------------------------------------------------------------------------
// Layout styles
// ---------------------------------------------------------------------------

/** Flex row with centered items */
export const flexRow = (gap: number = 8): CSSProperties => ({
  display: "flex",
  gap,
  alignItems: "center",
});

/** Flex column filling available space */
export const flexColumn: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
};

/** Centered empty / loading / error message */
export const centeredMessage: CSSProperties = {
  margin: "auto",
  textAlign: "center",
  padding: 40,
};

// ---------------------------------------------------------------------------
// Component styles
// ---------------------------------------------------------------------------

/** Preview header bar */
export const previewHeader: CSSProperties = {
  padding: "14px 22px",
  borderBottom: "1px solid var(--border)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 12,
};

/** Grid layout for KPI/metric cards */
export const kpiGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 12,
};

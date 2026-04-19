import type { CSSProperties, ReactNode } from "react";

/**
 * Shared primitive for dense definition lists. See DESIGN.md App Detail
 * Redesign Extensions → Component Primitives.
 *
 * No card chrome, no borders, no per-row decoration. Two-column grid:
 *   label  = 11px caption, uppercase, letter-spacing 0.7px, --text-dim
 *   value  = 14px body, --text
 *
 * Used on every entity detail page going forward (Overview tab for
 * /apps, plus /projects and /capabilities once they land).
 *
 * Render hints:
 *   - Rows with null/undefined/'' values are skipped automatically.
 *   - Values can be strings or ReactNodes (for embedded pills/links).
 *   - `wide` rows span full-width below their label (good for free-text
 *     descriptions).
 */

export interface MetadataRow {
  label: string;
  /** String, number, or any ReactNode (pill, link, etc). */
  value: ReactNode | string | number | null | undefined;
  /**
   * Render the value below the label at full width — use for long
   * descriptions or lists that don't fit inline.
   */
  wide?: boolean;
  /** Override value typography (e.g., monospace for IDs / numbers). */
  mono?: boolean;
}

export interface MetadataListProps {
  rows: MetadataRow[];
  /** Override min-width of the label column. Default 130px. */
  labelColumnWidth?: number;
  style?: CSSProperties;
}

function isEmpty(v: ReactNode | string | number | null | undefined): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

export function MetadataList({
  rows,
  labelColumnWidth = 130,
  style,
}: MetadataListProps) {
  const visible = rows.filter((r) => !isEmpty(r.value));
  if (visible.length === 0) return null;

  return (
    <dl
      style={{
        display: "grid",
        gridTemplateColumns: `${labelColumnWidth}px 1fr`,
        rowGap: 8,
        columnGap: 24,
        margin: 0,
        ...style,
      }}
    >
      {visible.map((row, idx) => (
        <MetadataListRow key={`${row.label}-${idx}`} row={row} />
      ))}
    </dl>
  );
}

function MetadataListRow({ row }: { row: MetadataRow }) {
  const { label, value, wide, mono } = row;
  if (wide) {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <dt
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            letterSpacing: 0.7,
            color: "var(--text-dim)",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          {label}
        </dt>
        <dd
          style={{
            margin: 0,
            fontSize: 14,
            color: "var(--text-muted)",
            lineHeight: 1.55,
            maxWidth: 980,
          }}
        >
          {value}
        </dd>
      </div>
    );
  }
  return (
    <>
      <dt
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          letterSpacing: 0.7,
          color: "var(--text-dim)",
          textTransform: "uppercase",
          paddingTop: 2,
        }}
      >
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontSize: 14,
          color: "var(--text)",
          fontFamily: mono ? "var(--font-mono)" : undefined,
        }}
      >
        {value}
      </dd>
    </>
  );
}

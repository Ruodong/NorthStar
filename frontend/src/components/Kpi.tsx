import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared NorthStar Kpi — uppercase label over a big display-font number.
 *
 * Absorbs what used to be two inline definitions:
 *   - `apps/[app_id]/_shared/Kpi.tsx` (simple: label + value)
 *   - `dashboard/page.tsx` dashboard Kpi (label + value + href + hint)
 *
 * When `href` is set, the whole card becomes a Link (no nested
 * `<a>`-inside-`<button>` issues). When `hint` is set, a mono caption
 * renders below the value.
 *
 * Two size variants:
 *   - "md" (default) — App Detail panels (font-size 28, used in
 *     ImpactTab + deploy KPI strips)
 *   - "lg" — Dashboard KPI grid (font-size 38, uses .kpi-card class)
 */
export interface KpiProps {
  label: string;
  value: number | string;
  /** When set, whole card is wrapped in a Next Link. */
  href?: string;
  /** Optional mono caption line below the value. */
  hint?: ReactNode;
  /** "md" default 28px, "lg" 38px for dashboard grids. */
  size?: "md" | "lg";
}

export function Kpi({ label, value, href, hint, size = "md" }: KpiProps) {
  if (size === "lg") {
    const body = (
      <>
        <div className="kpi-label">{label}</div>
        <div className="kpi-value">
          {typeof value === "number" ? value.toLocaleString() : value}
        </div>
        {hint && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              color: "var(--text-dim)",
              marginTop: 6,
            }}
          >
            {hint}
          </div>
        )}
      </>
    );
    if (href) {
      return (
        <Link
          href={href}
          className="kpi-card"
          style={{ textDecoration: "none", cursor: "pointer" }}
        >
          {body}
        </Link>
      );
    }
    return <div className="kpi-card">{body}</div>;
  }

  // "md" default — inline 28px number used inside panels (ImpactTab etc.)
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-dim)",
          marginBottom: 2,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 28,
          fontWeight: 600,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {hint && (
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10,
            color: "var(--text-dim)",
            marginTop: 4,
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

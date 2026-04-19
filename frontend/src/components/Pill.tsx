import type { CSSProperties } from "react";

/**
 * Shared status / badge pill for NorthStar.
 * See DESIGN.md — "Status pill: 2px radius, 11px caption, bg uses status color
 * at ~15% opacity, text uses status color at full. Four corners, no bubble."
 *
 * `tone` accepts one of the preset semantic keys or any CSS color string
 * (including `var(--...)` references). This lets status pills reuse the same
 * shape whether they come from a semantic map or a raw color.
 */

type Tone =
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "muted";

const TONE_COLORS: Record<Tone, string> = {
  accent: "var(--accent)",
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  info: "var(--info)",
  neutral: "var(--text-muted)",
  muted: "var(--text-dim)",
};

export interface PillProps {
  label: string;
  tone?: Tone | string;
  size?: "sm" | "md";
  style?: CSSProperties;
}

export function Pill({ label, tone = "neutral", size = "md", style }: PillProps) {
  const color = (TONE_COLORS as Record<string, string>)[tone] ?? tone;
  const sizeStyle: CSSProperties =
    size === "sm"
      ? { fontSize: 10, padding: "2px 8px" }
      : { fontSize: 11, padding: "3px 10px" };
  return (
    <span
      style={{
        display: "inline-block",
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        border: `1px solid ${color}`,
        borderRadius: "var(--radius-sm)",
        textTransform: "uppercase",
        letterSpacing: 0.6,
        fontWeight: 600,
        fontFamily: "var(--font-body)",
        ...sizeStyle,
        ...style,
      }}
    >
      {label}
    </span>
  );
}

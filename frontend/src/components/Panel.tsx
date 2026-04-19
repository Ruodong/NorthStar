import type { ReactNode } from "react";

/**
 * Shared NorthStar Panel — flat card with an uppercase section title.
 *
 * Absorbs what used to be two inline definitions:
 *   - `apps/[app_id]/_shared/Panel.tsx` (simple: title + children)
 *   - `app/page.tsx` home-page Panel (title + `action` slot + children)
 *
 * Optional `action` renders top-right of the title row (e.g., a "See all →"
 * link or a dropdown). When absent, the title sits on its own line.
 *
 * See DESIGN.md Components → Panel. Deliberately no shadow; depth comes
 * from border-color only.
 */
export interface PanelProps {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}

export function Panel({ title, action, children }: PanelProps) {
  const showActionRow = action !== undefined && action !== null;
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        padding: 20,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: showActionRow ? 14 : 12,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--text-muted)",
          }}
        >
          {title}
        </div>
        {showActionRow && action}
      </div>
      {children}
    </div>
  );
}

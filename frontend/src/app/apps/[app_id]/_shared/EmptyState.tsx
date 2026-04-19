import React from "react";

export function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "8px 0" }}>
      {children}
    </div>
  );
}

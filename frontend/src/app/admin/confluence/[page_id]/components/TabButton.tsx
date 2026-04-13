// TabButton.tsx — tab navigation + small UI primitives
// Split from page.tsx for maintainability.

import React from "react";

export function TabButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        color: active ? "var(--text)" : disabled ? "var(--text-dim)" : "var(--text-muted)",
        border: 0,
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        borderRadius: 0,
        padding: "10px 18px",
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        marginBottom: -1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function NameWithCode({
  name,
  code,
}: {
  name: string | null;
  code: string;
}) {
  if (name) {
    return (
      <span>
        {name}{" "}
        <code style={{ color: "var(--text-dim)", fontSize: 11 }}>{code}</code>
      </span>
    );
  }
  return <code>{code}</code>;
}

export function KV({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 9,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: "var(--text-muted)",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div style={{ color: "var(--text)" }}>{children}</div>
    </div>
  );
}

export function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        color: "var(--text-dim)",
        marginLeft: 6,
      }}
    >
      {children}
    </span>
  );
}

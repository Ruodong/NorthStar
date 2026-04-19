"use client";

// Next 14 convention: catches errors thrown during page render OR during
// the RSC fetch (fetchAppDetail throws on backend 5xx / network failure).
// MUST be a client component per Next docs.

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[apps/[app_id]] error boundary caught:", error);
  }, [error]);

  return (
    <div
      style={{
        padding: 40,
        background: "var(--surface)",
        border: "1px solid rgba(232,113,107,0.3)",
        borderRadius: "var(--radius-lg)",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          color: "var(--error)",
          marginBottom: 6,
        }}
      >
        Couldn&apos;t load this app
      </div>
      <div
        style={{
          color: "var(--text-muted)",
          fontSize: 13,
          marginBottom: 16,
          fontFamily: "var(--font-mono)",
        }}
      >
        {error.message || "Unknown error"}
        {error.digest && (
          <span style={{ color: "var(--text-dim)", marginLeft: 8 }}>
            (digest: {error.digest})
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={() => reset()}
        style={{
          background: "var(--accent)",
          color: "#000",
          padding: "8px 16px",
          borderRadius: "var(--radius-md)",
          border: "none",
          fontWeight: 600,
          fontSize: 13,
          cursor: "pointer",
        }}
      >
        Try again
      </button>
    </div>
  );
}

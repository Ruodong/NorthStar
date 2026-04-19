import Link from "next/link";

// Next 14 convention: rendered when fetchAppDetail() returns null and the
// RSC page calls notFound(). No appId in scope here (Next doesn't pass
// route params to not-found.tsx) — copy is intentionally generic.

export default function NotFound() {
  return (
    <div
      style={{
        padding: 40,
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-lg)",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 18,
          marginBottom: 6,
        }}
      >
        App not found
      </div>
      <div
        style={{
          color: "var(--text-muted)",
          fontSize: 13,
          marginBottom: 16,
        }}
      >
        That application id doesn&apos;t exist in the graph or in CMDB. Check
        the id and try again.
      </div>
      <Link
        href="/"
        style={{
          display: "inline-block",
          background: "var(--accent)",
          color: "#000",
          padding: "8px 16px",
          borderRadius: "var(--radius-md)",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 13,
        }}
      >
        Back to home
      </Link>
    </div>
  );
}

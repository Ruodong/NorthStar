import { StatusPill } from "./StatusPill";

// CMDB definition-list row. Used by OverviewTab today, will be reused by
// PR 3 MetadataList primitive promotion. Lives in _shared/ from the start
// to avoid moving twice.

export function CmdbField({
  label,
  value,
  resolvedName,
  mono,
  pill,
  wide,
}: {
  label: string;
  value?: string | null;
  resolvedName?: string | null;
  mono?: boolean;
  pill?: boolean;
  wide?: boolean;
}) {
  if (!value && !pill) return null;
  return (
    <div
      style={{
        display: wide ? "block" : "flex",
        gap: 12,
        fontSize: 13,
        lineHeight: 1.8,
      }}
    >
      <dt style={{ color: "var(--text-dim)", minWidth: 130, flexShrink: 0 }}>
        {label}
      </dt>
      <dd
        style={{
          margin: 0,
          fontFamily: mono ? "var(--font-mono)" : undefined,
          fontSize: mono ? 12 : undefined,
          ...(wide
            ? {
                marginTop: 2,
                color: "var(--text-muted)",
                fontSize: 12,
                lineHeight: 1.6,
              }
            : {}),
        }}
      >
        {pill ? (
          <StatusPill status={value || "Unknown"} />
        ) : (
          <>
            {resolvedName ? (
              <>
                {resolvedName}{" "}
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  {value}
                </span>
              </>
            ) : Array.isArray(value) ? (
              (value as string[]).join(", ")
            ) : (
              value
            )}
          </>
        )}
      </dd>
    </div>
  );
}

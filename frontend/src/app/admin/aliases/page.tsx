"use client";

import { useCallback, useEffect, useState } from "react";

interface PendingRow {
  id: number;
  norm_key: string;
  candidate_ids: string[];
  raw_names: string[];
  projects: string[];
  created_at: string;
  reviewed_at: string | null;
  decision: string | null;
  decided_by: string | null;
  canonical_id: string | null;
  note: string | null;
}

interface ManualAliasRow {
  alias_id: string;
  canonical_id: string;
  decided_at: string | null;
  decided_by: string | null;
  source_merge_id: number | null;
  note: string | null;
}

export default function AliasReviewPage() {
  const [pending, setPending] = useState<PendingRow[]>([]);
  const [manual, setManual] = useState<ManualAliasRow[]>([]);
  const [includeDecided, setIncludeDecided] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [decidedBy, setDecidedBy] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [p, m] = await Promise.all([
        fetch(
          `/api/admin/aliases/pending?include_decided=${includeDecided}&limit=200`,
          { cache: "no-store" }
        ).then((r) => r.json()),
        fetch("/api/admin/aliases/manual?limit=200", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (!p.success) throw new Error(p.error || "failed to load pending");
      if (!m.success) throw new Error(m.error || "failed to load manual");
      setPending(p.data || []);
      setManual(m.data || []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [includeDecided]);

  useEffect(() => {
    load();
  }, [load]);

  async function decide(
    mergeId: number,
    decision: "merge" | "keep_separate",
    canonicalId: string | null,
    note?: string
  ) {
    try {
      const res = await fetch(`/api/admin/aliases/pending/${mergeId}/decide`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          decision,
          canonical_id: canonicalId,
          decided_by: decidedBy || "unknown",
          note: note || null,
        }),
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || `decide failed (${res.status})`);
      await load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function deleteManual(aliasId: string) {
    if (!confirm(`Delete alias ${aliasId}? The merge will be undone on next loader run.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/admin/aliases/manual/${encodeURIComponent(aliasId)}`, {
        method: "DELETE",
      });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "delete failed");
      await load();
    } catch (e) {
      alert(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            marginBottom: 6,
            fontFamily: "var(--font-display)",
          }}
        >
          App Alias Review
        </h1>
        <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 760 }}>
          Candidate merges for non-CMDB applications. Groups below share the same normalized
          name signature. Decide whether they are the same real-world application (pick a
          canonical id and merge) or distinct apps that happen to have similar names
          (keep separate).
        </p>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          marginBottom: 16,
          padding: 12,
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
        }}
      >
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Decided by:{" "}
          <input
            type="text"
            value={decidedBy}
            placeholder="your itcode"
            onChange={(e) => setDecidedBy(e.target.value)}
            style={{
              marginLeft: 6,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              padding: "6px 10px",
              borderRadius: "var(--radius-md)",
              fontSize: 13,
            }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--text-muted)" }}>
          <input
            type="checkbox"
            checked={includeDecided}
            onChange={(e) => setIncludeDecided(e.target.checked)}
            style={{ marginRight: 6 }}
          />
          Include already-decided
        </label>
        <button
          type="button"
          onClick={load}
          style={{
            background: "transparent",
            border: "1px solid var(--border-strong)",
            color: "var(--text)",
            padding: "6px 14px",
            borderRadius: "var(--radius-md)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Refresh
        </button>
        {loading && <span style={{ color: "var(--text-dim)", fontSize: 12 }}>loading…</span>}
        {err && <span style={{ color: "var(--error)", fontSize: 12 }}>{err}</span>}
      </div>

      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 10,
          marginTop: 24,
        }}
      >
        Pending Candidates ({pending.filter((p) => !p.decision).length})
      </h2>

      {pending.length === 0 && (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "var(--text-dim)",
            border: "1px dashed var(--border)",
            borderRadius: "var(--radius-lg)",
          }}
        >
          No candidates. Run{" "}
          <code style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
            scripts/generate_merge_candidates.py
          </code>{" "}
          to refresh.
        </div>
      )}

      <div style={{ display: "grid", gap: 12 }}>
        {pending.map((row) => (
          <CandidateCard
            key={row.id}
            row={row}
            onDecide={(decision, canonicalId, note) =>
              decide(row.id, decision, canonicalId, note)
            }
          />
        ))}
      </div>

      <h2
        style={{
          fontSize: 11,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          color: "var(--text-muted)",
          marginBottom: 10,
          marginTop: 32,
        }}
      >
        Confirmed Aliases ({manual.length})
      </h2>

      {manual.length === 0 ? (
        <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No confirmed aliases yet.</div>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
          }}
        >
          <thead>
            <tr style={{ color: "var(--text-muted)", textTransform: "uppercase", fontSize: 10 }}>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                alias_id
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                → canonical_id
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                decided_by
              </th>
              <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                decided_at
              </th>
              <th style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}></th>
            </tr>
          </thead>
          <tbody>
            {manual.map((a) => (
              <tr key={a.alias_id}>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                  {a.alias_id}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", color: "var(--accent)" }}>
                  {a.canonical_id}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
                  {a.decided_by || "—"}
                </td>
                <td
                  style={{
                    padding: "8px 12px",
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text-muted)",
                  }}
                >
                  {a.decided_at ? new Date(a.decided_at).toISOString().slice(0, 10) : "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                  <button
                    type="button"
                    onClick={() => deleteManual(a.alias_id)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-strong)",
                      color: "var(--error)",
                      padding: "4px 10px",
                      borderRadius: "var(--radius-sm)",
                      fontSize: 11,
                      cursor: "pointer",
                    }}
                  >
                    Undo
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

interface CandidateCardProps {
  row: PendingRow;
  onDecide: (
    decision: "merge" | "keep_separate",
    canonicalId: string | null,
    note?: string
  ) => void;
}

function CandidateCard({ row, onDecide }: CandidateCardProps) {
  const [canonicalId, setCanonicalId] = useState<string>(row.candidate_ids[0] || "");
  const [note, setNote] = useState("");
  const decided = row.decision !== null;

  return (
    <div
      style={{
        padding: 16,
        background: "var(--surface)",
        border: `1px solid ${decided ? "var(--border)" : "var(--border-strong)"}`,
        borderRadius: "var(--radius-lg)",
        opacity: decided ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Norm key
          </div>
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--accent)",
            }}
          >
            {row.norm_key}
          </code>
        </div>
        {decided && (
          <span
            style={{
              fontSize: 11,
              padding: "2px 8px",
              background: row.decision === "merge" ? "rgba(95,197,138,0.15)" : "rgba(107,116,136,0.15)",
              color: row.decision === "merge" ? "var(--success)" : "var(--text-dim)",
              borderRadius: "var(--radius-sm)",
              textTransform: "uppercase",
            }}
          >
            {row.decision}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "var(--text-dim)",
            marginBottom: 6,
          }}
        >
          Candidate apps ({row.candidate_ids.length})
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          {row.candidate_ids.map((id, idx) => (
            <div
              key={id}
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                padding: "6px 10px",
                background: "var(--bg-elevated)",
                borderRadius: "var(--radius-sm)",
                fontSize: 12,
              }}
            >
              {!decided && (
                <input
                  type="radio"
                  name={`canonical-${row.id}`}
                  value={id}
                  checked={canonicalId === id}
                  onChange={(e) => setCanonicalId(e.target.value)}
                />
              )}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--text)",
                  minWidth: 160,
                }}
              >
                {id}
              </code>
              <span style={{ color: "var(--text-muted)", flex: 1 }}>
                {row.raw_names[idx] || "—"}
              </span>
            </div>
          ))}
        </div>
      </div>

      {row.projects.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: 0.6,
              color: "var(--text-dim)",
              marginBottom: 4,
            }}
          >
            Seen in projects
          </div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
            {row.projects.join(", ")}
          </div>
        </div>
      )}

      {!decided && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
          <input
            type="text"
            placeholder="note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            style={{
              flex: 1,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              padding: "6px 10px",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
          <button
            type="button"
            onClick={() => onDecide("merge", canonicalId, note)}
            style={{
              background: "var(--accent)",
              color: "#000",
              border: "none",
              padding: "7px 16px",
              borderRadius: "var(--radius-md)",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Merge → {canonicalId}
          </button>
          <button
            type="button"
            onClick={() => onDecide("keep_separate", null, note)}
            style={{
              background: "transparent",
              border: "1px solid var(--border-strong)",
              color: "var(--text)",
              padding: "7px 16px",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Keep separate
          </button>
        </div>
      )}
    </div>
  );
}

// ExtractedView.tsx — drawio parser output + vision extracts
// Includes: ExtractedView, MajorAppsSection, ExtractedFileCard,
//           SummaryChip, StatusPill, MatchPill,
//           VisionExtractSection, VisionExtractCard, VisionExtractResult
// Split from page.tsx for maintainability.

"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  Attachment,
  ExtractedApp,
  ExtractedByAttachment,
  ExtractedData,
  ExtractedInteraction,
  ExtractedMajorApp,
  VisionExtractResponse,
} from "../types";
import { STATUS_COLOR, MATCH_STYLES } from "../constants";
import { humanSize } from "../utils";
import { tableHeadRow, cellPad, sectionLabel, tableRow, inlineId } from "../styles";

// ---------------------------------------------------------------------------
// Shared small components
// ---------------------------------------------------------------------------

export function SummaryChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "baseline",
        gap: 4,
        padding: "3px 10px",
        fontFamily: "var(--font-mono)",
        fontSize: 11,
        color,
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
      }}
    >
      <span style={{ fontWeight: 600 }}>{value}</span>
      <span style={{ fontSize: 9, color: "var(--text-dim)" }}>{label}</span>
    </span>
  );
}

export function StatusPill({ status }: { status: string | null }) {
  if (!status) return null;
  const color = STATUS_COLOR[status] || "var(--text-dim)";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "1px 6px",
        fontSize: 9,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color,
        background: "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${color}44`,
        borderRadius: "var(--radius-sm)",
      }}
    >
      {status}
    </span>
  );
}

function MatchPill({ app }: { app: ExtractedApp }) {
  const type = app.match_type || "no_cmdb";
  const spec = MATCH_STYLES[type] || MATCH_STYLES["no_cmdb"];
  const sim =
    app.name_similarity != null
      ? ` (sim=${app.name_similarity.toFixed(2)})`
      : "";
  const drawioId = app.standard_id || "—";
  const resolvedId = app.resolved_app_id || drawioId;
  const extraContext =
    type === "auto_corrected" || type === "auto_corrected_missing_id"
      ? `\n  drawio wrote: ${drawioId}${
          app.cmdb_name_for_drawio_id
            ? ` (${app.cmdb_name_for_drawio_id})`
            : ""
        }\n  resolved to: ${resolvedId}${
          app.cmdb_name_for_resolved
            ? ` (${app.cmdb_name_for_resolved})`
            : ""
        }`
      : type === "mismatch_unresolved"
      ? `\n  drawio wrote: ${drawioId}${
          app.cmdb_name_for_drawio_id
            ? ` → CMDB: ${app.cmdb_name_for_drawio_id}`
            : ""
        }\n  name "${app.app_name}" did not match anything`
      : "";
  const title = `${spec.tooltipBase}${sim}${extraContext}`;
  const isAutoCorrected =
    type === "auto_corrected" || type === "auto_corrected_missing_id";
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        fontSize: 10,
        fontFamily: "var(--font-mono)",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: spec.color,
        background: "rgba(255, 255, 255, 0.03)",
        border: `1px solid ${spec.color}55`,
        borderLeft: isAutoCorrected
          ? `2px solid ${spec.color}`
          : `1px solid ${spec.color}55`,
        borderRadius: "var(--radius-sm)",
        whiteSpace: "nowrap",
      }}
    >
      <span>{spec.icon}</span>
      <span>{spec.label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// MajorAppsSection
// ---------------------------------------------------------------------------

function MajorAppsSection({ majors }: { majors: ExtractedMajorApp[] }) {
  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "14px 18px 18px",
        background: "rgba(246, 166, 35, 0.03)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "var(--accent)",
            fontWeight: 600,
          }}
        >
          Major Applications ({majors.length})
        </span>
        <span
          style={{ fontSize: 10, color: "var(--text-dim)" }}
          title="Apps whose drawio cells were marked Change / New / Sunset — i.e. actively in scope for this project."
        >
          (status in Change / New / Sunset)
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={tableHeadRow}>
            <th style={{ ...cellPad, width: 100 }}>APP ID</th>
            <th style={cellPad}>Name</th>
            <th style={{ ...cellPad, width: 90 }}>Status</th>
            <th
              style={{ ...cellPad, width: 80, textAlign: "right" }}
              title="How many drawio cells across this page's subtree referenced this app as a major (Change/New/Sunset) app"
            >
              Refs
            </th>
          </tr>
        </thead>
        <tbody>
          {majors.map((m) => {
            const name = m.cmdb_name || m.drawio_name || m.app_id;
            return (
              <tr key={m.app_id} style={tableRow}>
                <td style={{ ...cellPad, fontFamily: "var(--font-mono)" }}>
                  <Link
                    href={`/admin/applications/${encodeURIComponent(m.app_id)}`}
                    style={{
                      color: m.cmdb_name ? "var(--accent)" : "var(--text-muted)",
                      textDecoration: "none",
                    }}
                  >
                    {m.app_id}
                  </Link>
                </td>
                <td style={{ ...cellPad, color: "var(--text)", wordBreak: "break-word" }}>
                  {name}
                  {m.cmdb_name &&
                    m.drawio_name &&
                    m.cmdb_name.toLowerCase() !== m.drawio_name.toLowerCase() && (
                      <span
                        title="drawio label (pre-reconciliation)"
                        style={inlineId}
                      >
                        · drawio: {m.drawio_name}
                      </span>
                    )}
                </td>
                <td style={cellPad}>
                  <StatusPill status={m.application_status} />
                </td>
                <td
                  style={{
                    ...cellPad,
                    textAlign: "right",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--text-muted)",
                  }}
                  title={(m.attachment_titles || []).join("\n")}
                >
                  {m.occurrence_count}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedFileCard — per-attachment breakdown with apps + interactions
// ---------------------------------------------------------------------------

function ExtractedFileCard({
  file,
  apps,
  interactions,
}: {
  file: ExtractedByAttachment;
  apps: ExtractedApp[];
  interactions: ExtractedInteraction[];
}) {
  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "14px 18px 18px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-word" }}>
            {file.attachment_title}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {file.source_kind === "referenced"
              ? `ref: ${file.source_page_title}`
              : file.source_kind === "descendant"
              ? `from child: ${file.source_page_title}`
              : "this page"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <SummaryChip label="apps" value={file.app_count} color="var(--text-muted)" />
          <SummaryChip label="A-id" value={file.app_with_std_id_count} color="var(--accent)" />
          <SummaryChip label="edges" value={file.interaction_count} color="var(--text-muted)" />
        </div>
      </div>

      {apps.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={sectionLabel}>Applications ({apps.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={{ ...cellPad, width: 100 }}>APP ID</th>
                <th style={{ ...cellPad, width: 110 }}>Match</th>
                <th style={cellPad}>Name</th>
                <th style={{ ...cellPad, width: 90 }}>Status</th>
                <th style={cellPad}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {apps.map((a) => {
                const displayId = a.resolved_app_id || a.standard_id;
                const wasCorrected =
                  a.match_type === "auto_corrected" ||
                  a.match_type === "auto_corrected_missing_id";
                const linkTargetId = displayId;
                const resolvedName = a.cmdb_name_for_resolved || a.cmdb_name;
                return (
                  <tr key={`${a.attachment_id}:${a.cell_id}`} style={tableRow}>
                    <td style={{ ...cellPad, fontFamily: "var(--font-mono)", verticalAlign: "top" }}>
                      {displayId ? (
                        <Link
                          href={`/admin/applications/${encodeURIComponent(linkTargetId || "")}`}
                          style={{
                            color: resolvedName ? "var(--accent)" : "var(--text-muted)",
                            textDecoration: "none",
                          }}
                        >
                          {displayId}
                        </Link>
                      ) : (
                        <span style={{ color: "var(--text-dim)" }}>—</span>
                      )}
                      {wasCorrected && a.standard_id && (
                        <div
                          style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}
                          title={`drawio wrote ${a.standard_id}${
                            a.cmdb_name_for_drawio_id ? ` (${a.cmdb_name_for_drawio_id})` : ""
                          }`}
                        >
                          was {a.standard_id}
                        </div>
                      )}
                    </td>
                    <td style={{ ...cellPad, verticalAlign: "top" }}>
                      <MatchPill app={a} />
                    </td>
                    <td style={{ ...cellPad, color: "var(--text)", wordBreak: "break-word", verticalAlign: "top" }}>
                      {a.app_name || resolvedName || "—"}
                      {resolvedName &&
                        a.app_name &&
                        resolvedName.toLowerCase() !== a.app_name.toLowerCase() && (
                          <span title={`CMDB name for ${displayId}`} style={inlineId}>
                            · CMDB: {resolvedName}
                          </span>
                        )}
                      {a.match_type === "mismatch_unresolved" && a.cmdb_name_for_drawio_id && (
                        <span
                          title={`drawio said ${a.standard_id} but that's "${a.cmdb_name_for_drawio_id}" in CMDB — no fuzzy match found`}
                          style={{
                            marginLeft: 8,
                            fontSize: 10,
                            color: "#e8716b",
                            fontFamily: "var(--font-mono)",
                          }}
                        >
                          ⚠ drawio id → CMDB: {a.cmdb_name_for_drawio_id}
                        </span>
                      )}
                    </td>
                    <td style={cellPad}>
                      <StatusPill status={a.application_status} />
                    </td>
                    <td style={{ ...cellPad, color: "var(--text-dim)", fontSize: 11, wordBreak: "break-word" }}>
                      {a.functions || ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {interactions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={sectionLabel}>Interactions ({interactions.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={cellPad}>From</th>
                <th style={{ ...cellPad, width: 30 }}></th>
                <th style={cellPad}>To</th>
                <th style={cellPad}>Business object / type</th>
                <th style={{ ...cellPad, width: 80 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {interactions.map((i) => {
                const fromLabel =
                  i.source_cmdb_name_resolved || i.source_app_name ||
                  i.source_cmdb_name_orig || i.source_resolved_id ||
                  i.source_standard_id || "—";
                const toLabel =
                  i.target_cmdb_name_resolved || i.target_app_name ||
                  i.target_cmdb_name_orig || i.target_resolved_id ||
                  i.target_standard_id || "—";
                const fromId = i.source_resolved_id || i.source_standard_id || null;
                const toId = i.target_resolved_id || i.target_standard_id || null;
                const fromHasCmdb = !!(i.source_cmdb_name_resolved || i.source_cmdb_name_orig);
                const toHasCmdb = !!(i.target_cmdb_name_resolved || i.target_cmdb_name_orig);
                const bo = i.business_object || i.interaction_type || "";
                return (
                  <tr key={`${i.attachment_id}:${i.edge_cell_id}`} style={tableRow}>
                    <td
                      style={{
                        ...cellPad,
                        color: fromHasCmdb ? "var(--text)" : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                      title={fromId || ""}
                    >
                      {fromId && fromHasCmdb ? (
                        <Link
                          href={`/admin/applications/${encodeURIComponent(fromId)}`}
                          style={{ color: "var(--text)", textDecoration: "none" }}
                        >
                          {fromLabel}
                        </Link>
                      ) : (
                        fromLabel
                      )}
                      {fromId && <span style={inlineId}>{fromId}</span>}
                    </td>
                    <td style={{ ...cellPad, color: "var(--text-dim)", textAlign: "center" }}>
                      →
                    </td>
                    <td
                      style={{
                        ...cellPad,
                        color: toHasCmdb ? "var(--text)" : "var(--text-muted)",
                        wordBreak: "break-word",
                      }}
                      title={toId || ""}
                    >
                      {toId && toHasCmdb ? (
                        <Link
                          href={`/admin/applications/${encodeURIComponent(toId)}`}
                          style={{ color: "var(--text)", textDecoration: "none" }}
                        >
                          {toLabel}
                        </Link>
                      ) : (
                        toLabel
                      )}
                      {toId && <span style={inlineId}>{toId}</span>}
                    </td>
                    <td style={{ ...cellPad, color: "var(--text-dim)", fontSize: 11, wordBreak: "break-word" }}>
                      {bo}
                    </td>
                    <td style={cellPad}>
                      <StatusPill status={i.interaction_status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VisionExtract components
// ---------------------------------------------------------------------------

function VisionExtractSection({ images }: { images: Attachment[] }) {
  return (
    <div
      style={{
        borderTop: "2px solid var(--border)",
        padding: "16px 18px 12px",
        background: "rgba(107, 166, 232, 0.03)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          From images (vision, PoC)
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "#e8b458",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "1px 5px",
            border: "1px solid #e8b45844",
            borderRadius: "var(--radius-sm)",
          }}
          title="Phase 1 PoC — results are not persisted and not yet in Neo4j"
        >
          ⚠ PoC · not persisted
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, lineHeight: 1.5 }}>
        Click Run Vision on any image below to send it through the
        LLM pipeline and see what applications + interactions it
        extracts. Results are ephemeral — they vanish on reload.
      </div>
      {images.map((img) => (
        <VisionExtractCard key={img.attachment_id} attachment={img} />
      ))}
    </div>
  );
}

function VisionExtractCard({ attachment }: { attachment: Attachment }) {
  const [state, setState] = useState<"idle" | "running" | "success" | "error">("idle");
  const [result, setResult] = useState<VisionExtractResponse | null>(null);
  const [errorCode, setErrorCode] = useState<string>("");
  const [errorDetail, setErrorDetail] = useState<string>("");

  async function runVision() {
    setState("running");
    setResult(null);
    setErrorCode("");
    setErrorDetail("");
    try {
      const resp = await fetch(
        `/api/admin/confluence/attachments/${attachment.attachment_id}/vision-extract`,
        { method: "GET", cache: "no-store" },
      );
      const body = await resp.json().catch(() => null);
      if (!resp.ok) {
        setState("error");
        setErrorCode(body?.error || `http_${resp.status}`);
        setErrorDetail(body?.detail || `HTTP ${resp.status}`);
        return;
      }
      setResult(body as VisionExtractResponse);
      setState("success");
    } catch (e) {
      setState("error");
      setErrorCode("network_error");
      setErrorDetail(String(e));
    }
  }

  const isDerived = attachment.title.startsWith("drawio-backup") || false;

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-sm)",
        padding: "12px 14px",
        marginBottom: 10,
        background: "var(--bg-elevated)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: state === "idle" ? 0 : 10,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: "var(--text)", wordBreak: "break-word" }}>
            {attachment.title}
          </div>
          <div
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              marginTop: 2,
            }}
          >
            {attachment.media_type} · {humanSize(attachment.file_size)}
          </div>
        </div>
        <button
          onClick={runVision}
          disabled={state === "running" || isDerived}
          style={{
            fontSize: 11,
            padding: "5px 12px",
            fontFamily: "var(--font-mono)",
            background: state === "running" ? "transparent" : "var(--accent)",
            color: state === "running" ? "var(--text-dim)" : "var(--bg)",
            border: state === "running" ? "1px solid var(--border)" : "none",
            borderRadius: "var(--radius-sm)",
            cursor: state === "running" ? "wait" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {state === "running"
            ? "Extracting… (up to 60s)"
            : state === "success"
            ? "Re-run"
            : "Run Vision"}
        </button>
      </div>

      {state === "error" && (
        <div
          style={{
            marginTop: 8,
            padding: "8px 10px",
            border: "1px solid #5b1f1f",
            borderRadius: "var(--radius-sm)",
            fontSize: 11,
            color: "var(--text-muted)",
          }}
        >
          <div style={{ fontFamily: "var(--font-mono)", color: "#e8716b" }}>
            {errorCode}
          </div>
          <div style={{ marginTop: 4 }}>{errorDetail}</div>
        </div>
      )}

      {state === "success" && result && <VisionExtractResult result={result} />}
    </div>
  );
}

function VisionExtractResult({ result }: { result: VisionExtractResponse }) {
  const [showRaw, setShowRaw] = useState(false);
  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 10, alignItems: "center" }}>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "var(--accent)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            padding: "1px 5px",
            border: "1px solid var(--accent)44",
            borderRadius: "var(--radius-sm)",
          }}
          title="AI-extracted output — review carefully before trusting"
        >
          ⚠ AI-extracted
        </span>
        <span
          style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {result.diagram_type}
        </span>
        <SummaryChip label="apps" value={result.applications.length} color="var(--text-muted)" />
        <SummaryChip label="edges" value={result.interactions.length} color="var(--text-muted)" />
        {result.tech_components.length > 0 && (
          <SummaryChip label="tech" value={result.tech_components.length} color="var(--text-muted)" />
        )}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-dim)",
            fontFamily: "var(--font-mono)",
            marginLeft: "auto",
          }}
        >
          {result.meta.model} · {result.meta.total_tokens.toLocaleString()} tok ·{" "}
          {(result.meta.wall_ms / 1000).toFixed(1)}s
        </span>
      </div>

      {result.applications.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Applications ({result.applications.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={{ ...cellPad, width: 110 }}>App ID</th>
                <th style={cellPad}>Name</th>
                <th style={{ ...cellPad, width: 80 }}>Status</th>
                <th style={cellPad}>Functions</th>
              </tr>
            </thead>
            <tbody>
              {result.applications.map((a, idx) => (
                <tr key={`${a.app_id}-${idx}`} style={tableRow}>
                  <td
                    style={{
                      ...cellPad,
                      fontFamily: "var(--font-mono)",
                      color: a.id_is_standard ? "var(--accent)" : "var(--text-dim)",
                    }}
                  >
                    {a.id_is_standard ? a.standard_id : "—"}
                  </td>
                  <td style={cellPad}>{a.name || "—"}</td>
                  <td style={cellPad}>
                    <StatusPill status={a.application_status || null} />
                  </td>
                  <td style={{ ...cellPad, fontSize: 11, color: "var(--text-muted)" }}>
                    {a.functions.slice(0, 3).join(", ")}
                    {a.functions.length > 3 ? ` … +${a.functions.length - 3}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.interactions.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Interactions ({result.interactions.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={cellPad}>Source → Target</th>
                <th style={{ ...cellPad, width: 90 }}>Type</th>
                <th style={{ ...cellPad, width: 80 }}>Status</th>
                <th style={cellPad}>Business object</th>
              </tr>
            </thead>
            <tbody>
              {result.interactions.map((i, idx) => (
                <tr key={idx} style={tableRow}>
                  <td style={{ ...cellPad, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {i.source_app_id} → {i.target_app_id}
                  </td>
                  <td style={{ ...cellPad, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {i.interaction_type || "—"}
                  </td>
                  <td style={cellPad}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      title={
                        i.status_inferred_from_endpoints
                          ? "Inferred from endpoint status, not directly read from the line color"
                          : ""
                      }
                    >
                      <StatusPill status={i.interface_status || null} />
                      {i.status_inferred_from_endpoints && (
                        <span style={{ color: "var(--text-dim)", fontSize: 10 }}>*</span>
                      )}
                    </span>
                  </td>
                  <td style={{ ...cellPad, fontSize: 11, color: "var(--text-muted)" }}>
                    {i.business_object || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result.tech_components.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={sectionLabel}>Tech components ({result.tech_components.length})</div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={tableHeadRow}>
                <th style={cellPad}>Name</th>
                <th style={{ ...cellPad, width: 140 }}>Layer</th>
                <th style={{ ...cellPad, width: 100 }}>Deploy</th>
                <th style={cellPad}>Runtime</th>
              </tr>
            </thead>
            <tbody>
              {result.tech_components.map((t, idx) => (
                <tr key={idx} style={tableRow}>
                  <td style={cellPad}>{t.name || "—"}</td>
                  <td style={{ ...cellPad, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {t.layer || "—"}
                  </td>
                  <td style={{ ...cellPad, fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>
                    {t.deploy_mode || "—"}
                  </td>
                  <td style={{ ...cellPad, fontSize: 11, color: "var(--text-muted)" }}>
                    {t.runtime || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <button
          onClick={() => setShowRaw((v) => !v)}
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-dim)",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showRaw ? "▾ Hide" : "▸ Show"} raw JSON
        </button>
        {showRaw && (
          <pre
            style={{
              marginTop: 6,
              padding: 10,
              fontSize: 10,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflow: "auto",
              maxHeight: 300,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
            }}
          >
            {JSON.stringify(result, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedView — main container
// ---------------------------------------------------------------------------

export function ExtractedView({
  data,
  imageAttachments,
}: {
  data: ExtractedData | null;
  imageAttachments: Attachment[];
}) {
  if (!data) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        Loading extracted apps…
      </div>
    );
  }
  if (
    data.apps.length === 0
    && data.by_attachment.length === 0
    && imageAttachments.length === 0
  ) {
    return (
      <div className="empty" style={{ padding: 40 }}>
        No apps extracted yet from drawios on this page.
        <br />
        <small style={{ color: "var(--text-dim)" }}>
          Run <code>scripts/parse_confluence_drawios.py</code> on 71 and reload.
        </small>
      </div>
    );
  }

  const appsByAttachment = new Map<string, ExtractedApp[]>();
  for (const a of data.apps) {
    const list = appsByAttachment.get(a.attachment_id) || [];
    list.push(a);
    appsByAttachment.set(a.attachment_id, list);
  }
  const intersByAttachment = new Map<string, ExtractedInteraction[]>();
  for (const i of data.interactions) {
    const list = intersByAttachment.get(i.attachment_id) || [];
    list.push(i);
    intersByAttachment.set(i.attachment_id, list);
  }

  const totalApps = data.apps.length;
  const totalStd = data.apps.filter((a) => a.standard_id).length;
  const totalInters = data.interactions.length;
  const hasDrawio = data.by_attachment.length > 0;

  const visionApps = data.vision_apps ?? [];
  const visionInters = data.vision_interactions ?? [];
  const visionByAtt = data.vision_by_attachment ?? [];
  const hasVision = visionByAtt.length > 0;

  const visionAppsByAtt = new Map<string, ExtractedApp[]>();
  for (const a of visionApps) {
    const list = visionAppsByAtt.get(a.attachment_id) || [];
    list.push(a);
    visionAppsByAtt.set(a.attachment_id, list);
  }
  const visionIntersByAtt = new Map<string, ExtractedInteraction[]>();
  for (const i of visionInters) {
    const list = visionIntersByAtt.get(i.attachment_id) || [];
    list.push(i);
    visionIntersByAtt.set(i.attachment_id, list);
  }

  const extractedImageIds = new Set(visionByAtt.map((v) => v.attachment_id));
  const unextractedImages = imageAttachments.filter(
    (a) => !extractedImageIds.has(a.attachment_id)
  );

  return (
    <div>
      {data.major_apps && data.major_apps.length > 0 && (
        <div className="panel" style={{ padding: 0, marginBottom: 16 }}>
          <MajorAppsSection majors={data.major_apps} />
        </div>
      )}

      {hasDrawio && (
        <div className="panel" style={{ padding: 0 }}>
          <div
            className="panel-title"
            style={{
              padding: "18px 18px 12px",
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span>Extracted from drawio diagrams</span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SummaryChip label="apps" value={totalApps} color="var(--text-muted)" />
              <SummaryChip label="A-id" value={totalStd} color="var(--accent)" />
              <SummaryChip label="edges" value={totalInters} color="var(--text-muted)" />
              <SummaryChip label="files" value={data.by_attachment.length} color="var(--text-muted)" />
            </div>
          </div>

          {data.by_attachment.map((f) => {
            const apps = appsByAttachment.get(f.attachment_id) || [];
            const inters = intersByAttachment.get(f.attachment_id) || [];
            return (
              <ExtractedFileCard key={f.attachment_id} file={f} apps={apps} interactions={inters} />
            );
          })}
        </div>
      )}

      {hasVision && (
        <div className="panel" style={{ padding: 0, marginTop: hasDrawio ? 16 : 0 }}>
          <div
            className="panel-title"
            style={{
              padding: "18px 18px 12px",
              display: "flex",
              gap: 16,
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <span>
              Extracted from images
              <span style={{
                fontSize: 10,
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                marginLeft: 8,
                textTransform: "uppercase",
              }}>
                AI vision
              </span>
            </span>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <SummaryChip label="apps" value={visionApps.length} color="var(--text-muted)" />
              <SummaryChip label="A-id" value={visionApps.filter((a) => a.standard_id).length} color="var(--accent)" />
              <SummaryChip label="edges" value={visionInters.length} color="var(--text-muted)" />
              <SummaryChip label="files" value={visionByAtt.length} color="var(--text-muted)" />
            </div>
          </div>

          {visionByAtt.map((f) => {
            const apps = visionAppsByAtt.get(f.attachment_id) || [];
            const inters = visionIntersByAtt.get(f.attachment_id) || [];
            return (
              <ExtractedFileCard key={`v-${f.attachment_id}`} file={f} apps={apps} interactions={inters} />
            );
          })}
        </div>
      )}

      {unextractedImages.length > 0 && (
        <div className="panel" style={{ padding: 0, marginTop: (hasDrawio || hasVision) ? 16 : 0 }}>
          <VisionExtractSection images={unextractedImages} />
        </div>
      )}
    </div>
  );
}

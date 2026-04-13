// QuestionnaireView.tsx — renders parsed Q&A sections from Confluence page body
// Split from page.tsx for maintainability.

"use client";

import type { Questionnaire } from "../types";

export function QuestionnaireView({ questionnaire }: { questionnaire: Questionnaire | null }) {
  if (!questionnaire) {
    return (
      <div className="panel">
        <div className="empty">
          No questionnaire parsed. Run the scanner without <code>--no-body</code> to
          populate this page.
        </div>
      </div>
    );
  }
  if (questionnaire.sections.length === 0 && questionnaire.expand_panels.length === 0) {
    return (
      <div className="panel">
        <div className="empty">Body parsed but contained no structured Q&A.</div>
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {questionnaire.sections.map((s, i) => (
        <div key={i} className="panel">
          <div
            className="panel-title"
            style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}
          >
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--accent)",
              }}
            >
              H{s.level || "-"}
            </span>
            <span style={{ color: "var(--text)", fontSize: 14, textTransform: "none" }}>
              {s.heading || "(unnamed)"}
            </span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 10,
                color: "var(--text-dim)",
              }}
            >
              {s.rows.length} rows
            </span>
          </div>
          <table>
            <tbody>
              {s.rows.map((r, j) => (
                <tr key={j}>
                  <th style={{ width: "30%", verticalAlign: "top", whiteSpace: "nowrap" }}>
                    {r.key || "—"}
                  </th>
                  <td
                    style={{
                      color: "var(--text)",
                      fontSize: 13,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}
                  >
                    {r.value || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      {questionnaire.expand_panels.length > 0 && (
        <div className="panel">
          <div className="panel-title">Expand Panels</div>
          {questionnaire.expand_panels.map((p, i) => (
            <details
              key={i}
              style={{
                padding: "12px 0",
                borderBottom: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontSize: 13,
              }}
            >
              <summary style={{ cursor: "pointer", color: "var(--text)", fontWeight: 500 }}>
                {p.title || "(expand)"}
              </summary>
              <div style={{ marginTop: 10, whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                {p.content_text || "(empty)"}
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

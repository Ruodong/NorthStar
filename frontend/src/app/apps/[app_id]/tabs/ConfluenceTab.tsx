"use client";

import type { ReviewPage } from "../_shared/types";
import { Panel } from "../_shared/Panel";
import { EmptyState } from "../_shared/EmptyState";

export function ConfluenceTab({ pages }: { pages: ReviewPage[] }) {
  if (pages.length === 0) {
    return (
      <Panel title="Confluence Review Pages">
        <EmptyState>No review pages found for this application.</EmptyState>
      </Panel>
    );
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {pages.map((p) => (
        <Panel key={p.page_id} title={`${p.fiscal_year} — ${p.title}`}>
          <div
            style={{
              display: "flex",
              gap: 16,
              flexWrap: "wrap",
              fontSize: 12,
              color: "var(--text-dim)",
              marginBottom: 12,
            }}
          >
            {p.q_pm && (
              <span>
                PM: <strong style={{ color: "var(--text-muted)" }}>{p.q_pm}</strong>
              </span>
            )}
            {p.q_it_lead && (
              <span>
                IT Lead:{" "}
                <strong style={{ color: "var(--text-muted)" }}>{p.q_it_lead}</strong>
              </span>
            )}
            {p.q_dt_lead && (
              <span>
                DT Lead:{" "}
                <strong style={{ color: "var(--text-muted)" }}>{p.q_dt_lead}</strong>
              </span>
            )}
            {p.body_size_chars != null && (
              <span>{p.body_size_chars.toLocaleString()} chars</span>
            )}
            <a
              href={p.page_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: "var(--accent)", fontSize: 11 }}
            >
              Open in Confluence ↗
            </a>
          </div>
          {p.questionnaire_sections && p.questionnaire_sections.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {p.questionnaire_sections.map((sec, si) => (
                <div key={si}>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: 0.5,
                      color: "var(--text-dim)",
                      marginBottom: 4,
                    }}
                  >
                    {sec.title}
                  </div>
                  <dl style={{ margin: 0, fontSize: 12, lineHeight: 1.7 }}>
                    {sec.rows.map((row, ri) => (
                      <div
                        key={ri}
                        style={{
                          display: "flex",
                          gap: 12,
                          borderBottom: "1px solid var(--border)",
                          padding: "3px 0",
                        }}
                      >
                        <dt
                          style={{
                            color: "var(--text-dim)",
                            minWidth: 200,
                            flexShrink: 0,
                          }}
                        >
                          {row.label}
                        </dt>
                        <dd
                          style={{
                            margin: 0,
                            color: "var(--text-muted)",
                            wordBreak: "break-word",
                          }}
                        >
                          {row.value || "—"}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ))}
            </div>
          )}
        </Panel>
      ))}
    </div>
  );
}

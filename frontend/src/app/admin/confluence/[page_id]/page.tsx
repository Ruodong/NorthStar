"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import type { Attachment, Detail, ExtractedData, Tab } from "./types";
import { KIND_LABEL, KIND_COLOR } from "./constants";
import { humanSize } from "./utils";

import { TabButton, NameWithCode, KV, Chip } from "./components/TabButton";
import { AttachmentPreview, SourceBadge } from "./components/AttachmentPreview";
import { QuestionnaireView } from "./components/QuestionnaireView";
import { RawHtmlView } from "./components/RawHtmlView";
import { HierarchyView } from "./components/HierarchyView";
import { ExtractedView } from "./components/ExtractedView";

export default function ConfluencePageDetail() {
  const params = useParams();
  const pageId = params.page_id as string;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [extracted, setExtracted] = useState<ExtractedData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Attachment | null>(null);
  // Read initial tab from URL query param (?tab=extracted) so the list
  // page's APP NAME link can deep-link directly to the Extracted tab.
  const [tab, setTab] = useState<Tab>(() => {
    if (typeof window === "undefined") return "attachments";
    const sp = new URLSearchParams(window.location.search);
    const t = sp.get("tab");
    if (t && ["attachments", "extracted", "hierarchy", "questionnaire", "raw"].includes(t)) {
      return t as Tab;
    }
    return "attachments";
  });

  useEffect(() => {
    (async () => {
      try {
        const [rDetail, rExtracted] = await Promise.all([
          fetch(`/api/admin/confluence/pages/${pageId}`, { cache: "no-store" }),
          fetch(`/api/admin/confluence/pages/${pageId}/extracted`, {
            cache: "no-store",
          }),
        ]);
        const jDetail = await rDetail.json();
        if (!jDetail.success) throw new Error(jDetail.error);
        setDetail(jDetail.data);
        // auto-select first previewable
        const first = jDetail.data.attachments.find(
          (a: Attachment) =>
            a.local_path && ["drawio", "image", "pdf"].includes(a.file_kind)
        );
        if (first) setSelected(first);

        // Extraction is best-effort: if the endpoint errors (e.g. migration
        // 011 not applied on this host), the tab is hidden silently.
        if (rExtracted.ok) {
          const jExtracted = await rExtracted.json();
          if (jExtracted.success) setExtracted(jExtracted.data);
        }
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, [pageId]);

  if (err) {
    return (
      <div>
        <Link href="/admin/confluence" style={{ color: "var(--text-muted)" }}>
          ← All pages
        </Link>
        <div className="panel" style={{ marginTop: 16, borderColor: "#5b1f1f" }}>
          {err}
        </div>
      </div>
    );
  }

  if (!detail) return <div className="subtitle">Loading…</div>;

  const previewable = detail.attachments.filter(
    (a) => !a.title.startsWith("drawio-backup") && !a.title.startsWith("~")
  );
  const imageCount = previewable.filter((a) => a.file_kind === "image").length;
  const questionnaire = detail.page.questionnaire;
  const qRowCount =
    questionnaire?.sections.reduce((n, s) => n + s.rows.length, 0) ?? 0;

  return (
    <div>
      <Link
        href="/admin/confluence"
        style={{ color: "var(--text-muted)", fontSize: 13 }}
      >
        ← All pages
      </Link>
      <h1 style={{ marginTop: 12 }}>{detail.page.title}</h1>
      <div
        style={{
          display: "flex",
          gap: 18,
          marginBottom: 16,
          fontSize: 13,
          color: "var(--text-muted)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span>
          <code>{detail.page.fiscal_year}</code>
        </span>
        {detail.page.project_id && (
          <span>
            Project <code>{detail.page.project_id}</code>
          </span>
        )}
        <a
          href={detail.page.page_url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--accent)" }}
        >
          Open in Confluence ↗
        </a>
        {detail.page.body_size_chars ? (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            body: {detail.page.body_size_chars.toLocaleString()} chars
          </span>
        ) : null}
      </div>

      {/* Linked project info extracted from questionnaire */}
      {(detail.page.q_project_id ||
        detail.page.q_pm ||
        detail.page.q_it_lead ||
        detail.page.q_dt_lead) && (
        <div
          className="panel"
          style={{
            marginBottom: 16,
            padding: "14px 20px",
            borderLeft: "2px solid var(--accent)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: 0.7,
              color: "var(--accent)",
              marginBottom: 10,
            }}
          >
            Linked Project (from questionnaire)
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 14,
              fontSize: 12,
            }}
          >
            {detail.page.q_project_id && (
              <KV label="Project ID">
                <Link
                  href={`/admin/projects?q=${encodeURIComponent(detail.page.q_project_id)}`}
                  style={{ color: "var(--accent)" }}
                >
                  <code>{detail.page.q_project_id}</code>
                </Link>
              </KV>
            )}
            {detail.page.q_project_name && (
              <KV label="Name">{detail.page.q_project_name}</KV>
            )}
            {detail.page.q_pm && (
              <KV label="PM">
                <NameWithCode name={detail.page.q_pm_name} code={detail.page.q_pm} />
              </KV>
            )}
            {detail.page.q_it_lead && (
              <KV label="IT Lead">
                <NameWithCode name={detail.page.q_it_lead_name} code={detail.page.q_it_lead} />
              </KV>
            )}
            {detail.page.q_dt_lead && (
              <KV label="DT Lead">
                <NameWithCode name={detail.page.q_dt_lead_name} code={detail.page.q_dt_lead} />
              </KV>
            )}
          </div>
        </div>
      )}

      {/* Tab bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          marginBottom: 16,
          borderBottom: "1px solid var(--border-strong)",
        }}
      >
        <TabButton active={tab === "attachments"} onClick={() => setTab("attachments")}>
          Attachments <Chip>{previewable.length}</Chip>
        </TabButton>
        <TabButton
          active={tab === "extracted"}
          onClick={() => setTab("extracted")}
          disabled={!extracted || (
            extracted.apps.length === 0
            && (extracted.vision_apps?.length ?? 0) === 0
            && imageCount === 0
          )}
        >
          Extracted <Chip>{
            (extracted?.apps.length ?? 0) + (extracted?.vision_apps?.length ?? 0)
            || (imageCount > 0 ? `${imageCount} img` : 0)
          }</Chip>
        </TabButton>
        <TabButton active={tab === "hierarchy"} onClick={() => setTab("hierarchy")}>
          Hierarchy{" "}
          <Chip>
            {detail.children.length + (detail.parent ? 1 : 0)}
          </Chip>
        </TabButton>
        <TabButton
          active={tab === "questionnaire"}
          onClick={() => setTab("questionnaire")}
          disabled={!questionnaire}
        >
          Questionnaire <Chip>{qRowCount}</Chip>
        </TabButton>
        <TabButton
          active={tab === "raw"}
          onClick={() => setTab("raw")}
          disabled={!detail.page.has_body}
        >
          Raw HTML
        </TabButton>
      </div>

      {tab === "attachments" && (
        <div style={{ display: "grid", gridTemplateColumns: "340px 1fr", gap: 16 }}>
          {/* Attachment list */}
          <div
            className="panel"
            style={{ padding: 0, overflow: "hidden", maxHeight: 720, overflowY: "auto" }}
          >
            <div className="panel-title" style={{ padding: "18px 18px 10px" }}>
              Attachments ({previewable.length})
            </div>
            {previewable.length === 0 && <div className="empty">No attachments.</div>}
            {previewable.map((a) => {
              const isSelected = selected?.attachment_id === a.attachment_id;
              return (
                <button
                  key={a.attachment_id}
                  onClick={() => setSelected(a)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: isSelected ? "var(--surface-hover)" : "transparent",
                    borderLeft: isSelected
                      ? "2px solid var(--accent)"
                      : "2px solid transparent",
                    padding: "12px 18px",
                    borderRadius: 0,
                    border: 0,
                    borderBottom: "1px solid var(--border)",
                    color: "var(--text)",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        color: KIND_COLOR[a.file_kind] || "var(--text-muted)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: 0.6,
                      }}
                    >
                      {KIND_LABEL[a.file_kind] || a.file_kind}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-dim)",
                      }}
                    >
                      {humanSize(a.file_size)}
                    </span>
                  </div>
                  <div style={{ marginTop: 4, wordBreak: "break-all" }}>{a.title}</div>
                  <SourceBadge a={a} />
                  {!a.local_path && (
                    <div style={{ fontSize: 10, color: "#e8716b", marginTop: 3 }}>
                      not downloaded
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Preview pane */}
          <div
            className="panel"
            style={{
              padding: 0,
              overflow: "hidden",
              minHeight: 720,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {!selected ? (
              <div className="empty" style={{ margin: "auto" }}>
                Pick an attachment to preview.
              </div>
            ) : (
              <AttachmentPreview attachment={selected} />
            )}
          </div>
        </div>
      )}

      {tab === "extracted" && (
        <ExtractedView
          data={extracted}
          imageAttachments={previewable.filter((a) => a.file_kind === "image")}
        />
      )}

      {tab === "hierarchy" && (
        <HierarchyView
          currentTitle={detail.page.title}
          currentDepth={detail.page.depth}
          parent={detail.parent}
          children={detail.children}
        />
      )}

      {tab === "questionnaire" && (
        <QuestionnaireView questionnaire={questionnaire} />
      )}

      {tab === "raw" && <RawHtmlView pageId={pageId} />}
    </div>
  );
}

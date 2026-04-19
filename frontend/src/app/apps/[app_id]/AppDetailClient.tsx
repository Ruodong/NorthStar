"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnswerBlock } from "@/components/AnswerBlock";
import type { AppDetailResponse, Tab } from "./_shared/types";
import { TabButton } from "./_shared/TabButton";
import { OverviewTab } from "./tabs/OverviewTab";
import { CapabilitiesTab } from "./tabs/CapabilitiesTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";
import { ImpactTab } from "./tabs/ImpactTab";
import { InvestmentsTab } from "./tabs/InvestmentsTab";
import { DiagramsTab } from "./tabs/DiagramsTab";
import { ConfluenceTab } from "./tabs/ConfluenceTab";
import { DeploymentTab } from "./tabs/DeploymentTab";
import { KnowledgeBaseTab } from "./tabs/KnowledgeBaseTab";

interface Props {
  initialData: AppDetailResponse;
  appId: string;
}

/**
 * Client orchestrator for the App Detail page (PR 3 redesign).
 *
 * Receives the main payload via RSC (see page.tsx + lib/api-server.ts)
 * so first paint already contains the AnswerBlock content. Only two
 * non-blocking secondary fetches remain client-side: capability_count
 * and deploy_count for tab-badge counts — if the capability_count
 * already arrived with the RSC payload (backend PR 3 §3a), we skip that
 * refetch.
 *
 * Layout (per mockup A2):
 *   AnswerBlock (title / pills / purpose / KPI strip / metadata)
 *   CTA bar     (View Impact · See Investments · Show Diagrams · Show Confluence)
 *   Tab nav     (3 groups: ABOUT · CONNECTIONS · WORK, single role="tablist")
 *   Tab panels  (role="tabpanel", lazy-mounted via conditional render)
 */

// ---- Tab definition ----
// One source of truth for the tab list. Rendering order in the nav
// matches this array. Group label + tab id + panel id + count derivation
// all flow from here.
interface TabDef {
  id: Tab;
  label: string;
  group: "ABOUT" | "CONNECTIONS" | "WORK";
  /** Optional count derivation from the data payload — undefined skips the badge. */
  count?: (data: AppDetailResponse, extras: Extras) => number | undefined;
}

interface Extras {
  deployCount?: number;
  capCount?: number;
}

const TABS: TabDef[] = [
  { id: "overview", label: "Overview", group: "ABOUT" },
  {
    id: "capabilities",
    label: "Capabilities",
    group: "ABOUT",
    count: (d, x) => x.capCount ?? d.capability_count,
  },
  { id: "integrations", label: "Integrations", group: "CONNECTIONS" },
  { id: "impact", label: "Impact Analysis", group: "CONNECTIONS" },
  {
    id: "deployment",
    label: "Deployment",
    group: "CONNECTIONS",
    count: (_d, x) => x.deployCount,
  },
  {
    id: "investments",
    label: "Investments",
    group: "WORK",
    count: (d) => d.investments.length,
  },
  {
    id: "diagrams",
    label: "Diagrams",
    group: "WORK",
    count: (d) => d.diagrams.length,
  },
  {
    id: "confluence",
    label: "Confluence",
    group: "WORK",
    count: (d) => (d.review_pages || []).length,
  },
  { id: "knowledge", label: "Knowledge Base", group: "WORK" },
];

const GROUP_ORDER: Array<"ABOUT" | "CONNECTIONS" | "WORK"> = [
  "ABOUT",
  "CONNECTIONS",
  "WORK",
];

export default function AppDetailClient({ initialData, appId }: Props) {
  const data = initialData;
  const [tab, setTab] = useState<Tab>("overview");
  const [deployCount, setDeployCount] = useState<number | undefined>(undefined);
  const [capCount, setCapCount] = useState<number | undefined>(
    data.capability_count,
  );

  // Per-tab button refs for keyboard focus management.
  const tabRefs = useRef(new Map<Tab, HTMLButtonElement | null>());

  // ---- Fetch deployment count for tab badge (non-blocking) ----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/masters/applications/${encodeURIComponent(appId)}/deployment`,
        );
        const j = await r.json();
        if (cancelled) return;
        if (j.success && j.data?.summary) {
          const s = j.data.summary;
          setDeployCount(
            s.servers +
              s.containers +
              s.databases +
              (s.object_storage || 0) +
              (s.nas || 0),
          );
        }
      } catch {
        /* non-blocking */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  // ---- Fetch capability count for tab badge ----
  // Skip if the RSC payload already carries it (backend PR 3 §3a).
  useEffect(() => {
    if (!appId) return;
    if (data.capability_count != null) return; // already have it
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(
          `/api/apps/${encodeURIComponent(appId)}/business-capabilities`,
          { cache: "no-store" },
        );
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        if (j.success) setCapCount(j.data.total_count);
      } catch {
        // silently ignore; badge just stays hidden
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId, data.capability_count]);

  const extras: Extras = { deployCount, capCount };

  // ---- Keyboard navigation across the single tablist ----
  // WAI-ARIA Authoring Practices — horizontal tabs pattern with
  // automatic activation (arrow keys switch tabs immediately, not just
  // focus). Home/End jump to first/last tab. Tab key leaves the list.
  const jumpTo = useCallback((targetId: Tab) => {
    setTab(targetId);
    // Focus on the next tick after React commits aria-selected update.
    queueMicrotask(() => {
      const el = tabRefs.current.get(targetId);
      el?.focus();
    });
  }, []);

  const handleTabKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, currentId: Tab) => {
      const idx = TABS.findIndex((t) => t.id === currentId);
      if (idx === -1) return;
      const last = TABS.length - 1;
      let nextIdx: number | null = null;
      switch (e.key) {
        case "ArrowRight":
          nextIdx = idx === last ? 0 : idx + 1;
          break;
        case "ArrowLeft":
          nextIdx = idx === 0 ? last : idx - 1;
          break;
        case "Home":
          nextIdx = 0;
          break;
        case "End":
          nextIdx = last;
          break;
        default:
          return;
      }
      e.preventDefault();
      if (nextIdx !== null) jumpTo(TABS[nextIdx].id);
    },
    [jumpTo],
  );

  // ---- AnswerBlock props derivation ----
  const { app, investments, diagrams, review_pages } = data;
  const reviewCount = (review_pages || []).length;
  const integrationsCount =
    (data.outbound?.length || 0) + (data.inbound?.length || 0);

  const pills: AnswerBlockProps["pills"] = [];
  if (app.app_ownership) {
    pills.push({ label: app.app_ownership, tone: "blue" });
  }
  if (app.portfolio_mgt) {
    pills.push({ label: app.portfolio_mgt, tone: "amber" });
  }

  // Metadata rows — concise overview, only 3 rows as per mockup A2.
  const ownerText = [
    app.owned_by_name && `Biz: ${app.owned_by_name}`,
    app.app_dt_owner_name && `DT: ${app.app_dt_owner_name}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const geoText = [
    app.data_residency_geo,
    app.data_residency_country,
    app.data_center,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <AnswerBlock
        appId={app.app_id}
        name={app.name}
        shortDescription={app.short_description}
        description={app.description}
        status={app.status}
        cmdbLinked={app.cmdb_linked}
        decommissionedAt={app.decommissioned_at}
        pills={pills}
        lastUpdated={app.last_updated}
        kpis={{
          integrations: integrationsCount,
          capabilities: capCount ?? data.capability_count,
          investments: investments.length,
        }}
        metadata={[
          { label: "Owners", value: ownerText || null },
          { label: "Geo", value: geoText || null },
          { label: "Source", value: app.source_system || null, mono: true },
        ]}
      />

      {/* CTA bar — quick jumps to the most-used tabs */}
      <nav
        aria-label="Primary actions"
        style={{
          display: "flex",
          gap: 10,
          marginBottom: 26,
          flexWrap: "wrap",
        }}
      >
        <CtaButton primary onClick={() => jumpTo("impact")}>
          View Impact →
        </CtaButton>
        <CtaButton onClick={() => jumpTo("investments")}>
          See Investments →
        </CtaButton>
        <CtaButton onClick={() => jumpTo("diagrams")}>
          Show Diagrams →
        </CtaButton>
        <CtaButton onClick={() => jumpTo("confluence")}>
          Show Confluence →
        </CtaButton>
      </nav>

      {/* Tab nav — single role="tablist" spanning 3 visually grouped segments */}
      <div
        style={{
          borderTop: "1px solid var(--border)",
          paddingTop: 18,
          marginBottom: 20,
        }}
      >
        <div
          role="tablist"
          aria-label="Application detail sections"
          aria-orientation="horizontal"
          style={{
            display: "flex",
            gap: 56,
            borderBottom: "1px solid var(--border)",
          }}
        >
          {GROUP_ORDER.map((group) => (
            <div key={group}>
              <div
                aria-hidden="true"
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--text-dim)",
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                {group}
              </div>
              <div style={{ display: "flex", gap: 18 }}>
                {TABS.filter((t) => t.group === group).map((def) => {
                  const count = def.count?.(data, extras);
                  const selected = tab === def.id;
                  return (
                    <TabButton
                      key={def.id}
                      value={def.id}
                      selected={selected}
                      onActivate={setTab}
                      count={count}
                      tabIndex={selected ? 0 : -1}
                      tabId={`tab-${def.id}`}
                      panelId={`panel-${def.id}`}
                      onKeyDown={(e) => handleTabKeyDown(e, def.id)}
                      buttonRef={(el) => {
                        tabRefs.current.set(def.id, el);
                      }}
                    >
                      {def.label}
                    </TabButton>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab content — every panel is aria-labelledby its tab + role="tabpanel" */}
      {tab === "overview" && (
        <TabPanel tabId="tab-overview" panelId="panel-overview">
          <OverviewTab
            app={app}
            investments={investments}
            confluencePages={data.confluence_pages}
            tco={data.tco}
          />
        </TabPanel>
      )}
      {tab === "capabilities" && (
        <TabPanel tabId="tab-capabilities" panelId="panel-capabilities">
          <CapabilitiesTab appId={app.app_id} />
        </TabPanel>
      )}
      {tab === "integrations" && (
        <TabPanel tabId="tab-integrations" panelId="panel-integrations">
          <IntegrationsTab appId={app.app_id} />
        </TabPanel>
      )}
      {tab === "impact" && (
        <TabPanel tabId="tab-impact" panelId="panel-impact">
          <ImpactTab appId={app.app_id} />
        </TabPanel>
      )}
      {tab === "investments" && (
        <TabPanel tabId="tab-investments" panelId="panel-investments">
          <InvestmentsTab investments={investments} />
        </TabPanel>
      )}
      {tab === "diagrams" && (
        <TabPanel tabId="tab-diagrams" panelId="panel-diagrams">
          <DiagramsTab diagrams={diagrams} />
        </TabPanel>
      )}
      {tab === "confluence" && (
        <TabPanel tabId="tab-confluence" panelId="panel-confluence">
          <ConfluenceTab pages={review_pages || []} />
        </TabPanel>
      )}
      {tab === "deployment" && (
        <TabPanel tabId="tab-deployment" panelId="panel-deployment">
          <DeploymentTab appId={app.app_id} />
        </TabPanel>
      )}
      {tab === "knowledge" && (
        <TabPanel tabId="tab-knowledge" panelId="panel-knowledge">
          <KnowledgeBaseTab appId={app.app_id} />
        </TabPanel>
      )}

      {/* Suppress unused `reviewCount` warning: it's surfaced via count fn. */}
      <span hidden>{reviewCount}</span>
    </>
  );
}

/**
 * Primary / ghost CTA button variants. The "primary" one is amber-filled
 * per DESIGN.md button principles; ghost has a 1px strong-border.
 */
function CtaButton({
  children,
  onClick,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        fontWeight: primary ? 600 : 500,
        padding: "8px 14px",
        borderRadius: "var(--radius-md)",
        cursor: "pointer",
        letterSpacing: 0.3,
        background: primary ? "var(--accent)" : "transparent",
        color: primary ? "var(--accent-on, #1a1306)" : "var(--text)",
        border: `1px solid ${primary ? "var(--accent)" : "var(--border-strong)"}`,
      }}
    >
      {children}
    </button>
  );
}

function TabPanel({
  tabId,
  panelId,
  children,
}: {
  tabId: string;
  panelId: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={tabId}
      tabIndex={0}
      style={{ outline: "none" }}
    >
      {children}
    </div>
  );
}

// ---- Type import for pills array (matches AnswerBlock.Props) ----
type AnswerBlockProps = import("@/components/AnswerBlock").AnswerBlockProps;

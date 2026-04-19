"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "@/components/Pill";
import type { AppDetailResponse, Tab } from "./_shared/types";
import { StatusPill } from "./_shared/StatusPill";
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
 * Client orchestrator for the App Detail page.
 *
 * Receives the main payload pre-fetched server-side via `fetchAppDetail()`
 * (see lib/api-server.ts), so there is no client-side loading state for
 * the primary content. Tab content lazy-fetches as needed.
 *
 * Two non-blocking secondary fetches still happen client-side because
 * they only feed tab-badge counts (visual hint, not a blocker for first
 * paint):
 *   - capCount   (Business Capabilities)
 *   - deployCount (Deployment)
 */
export default function AppDetailClient({ initialData, appId }: Props) {
  const data = initialData;
  const [tab, setTab] = useState<Tab>("overview");
  const [deployCount, setDeployCount] = useState<number | undefined>(undefined);
  const [capCount, setCapCount] = useState<number | undefined>(undefined);

  // Fetch deployment count for tab badge (non-blocking)
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

  // Fetch capability count for tab badge (non-blocking)
  useEffect(() => {
    if (!appId) return;
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
  }, [appId]);

  const { app, investments, diagrams, confluence_pages, tco, review_pages } = data;
  const reviewCount = (review_pages || []).length;

  return (
    <div>
      {/* ---------------- Header ---------------- */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--text-dim)",
            marginBottom: 8,
          }}
        >
          <Link href="/" style={{ color: "var(--text-dim)" }}>
            Home
          </Link>
          <span style={{ margin: "0 6px" }}>/</span>
          Application
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 14,
              color: "var(--text-muted)",
            }}
          >
            {app.app_id}
          </code>
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 28,
              fontWeight: 600,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            {app.name || "(unnamed)"}
          </h1>
          <StatusPill status={app.status} />
          {app.cmdb_linked && <Pill label="CMDB" tone="accent" size="sm" />}
          {app.app_ownership && <Pill label={app.app_ownership} tone="info" />}
          {app.portfolio_mgt && <Pill label={app.portfolio_mgt} tone="neutral" />}
        </div>
        {app.description && (
          <p
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              marginTop: 10,
              maxWidth: 760,
              lineHeight: 1.55,
            }}
          >
            {app.description.length > 280
              ? app.description.slice(0, 280) + "…"
              : app.description}
          </p>
        )}
      </div>

      {/* ---------------- Tab nav ---------------- */}
      <div
        style={{
          display: "flex",
          gap: 2,
          borderBottom: "1px solid var(--border-strong)",
          marginBottom: 20,
        }}
      >
        <TabButton current={tab} value="overview" onClick={setTab}>
          Overview
        </TabButton>
        <TabButton
          current={tab}
          value="capabilities"
          onClick={setTab}
          count={capCount}
        >
          Capabilities
        </TabButton>
        <TabButton current={tab} value="integrations" onClick={setTab}>
          Integrations
        </TabButton>
        <TabButton
          current={tab}
          value="deployment"
          onClick={setTab}
          count={deployCount}
        >
          Deployment
        </TabButton>
        <TabButton current={tab} value="impact" onClick={setTab}>
          Impact Analysis
        </TabButton>
        <TabButton
          current={tab}
          value="investments"
          onClick={setTab}
          count={investments.length}
        >
          Investments
        </TabButton>
        <TabButton
          current={tab}
          value="diagrams"
          onClick={setTab}
          count={diagrams.length}
        >
          Diagrams
        </TabButton>
        <TabButton
          current={tab}
          value="confluence"
          onClick={setTab}
          count={reviewCount}
        >
          Confluence
        </TabButton>
        <TabButton current={tab} value="knowledge" onClick={setTab}>
          Knowledge Base
        </TabButton>
      </div>

      {/* ---------------- Tab content ---------------- */}
      {tab === "overview" && (
        <OverviewTab
          app={app}
          investments={investments}
          confluencePages={confluence_pages}
          tco={tco}
        />
      )}
      {tab === "capabilities" && <CapabilitiesTab appId={app.app_id} />}
      {tab === "integrations" && <IntegrationsTab appId={app.app_id} />}
      {tab === "impact" && <ImpactTab appId={app.app_id} />}
      {tab === "investments" && <InvestmentsTab investments={investments} />}
      {tab === "diagrams" && <DiagramsTab diagrams={diagrams} />}
      {tab === "confluence" && <ConfluenceTab pages={review_pages || []} />}
      {tab === "deployment" && <DeploymentTab appId={app.app_id} />}
      {tab === "knowledge" && <KnowledgeBaseTab appId={app.app_id} />}
    </div>
  );
}

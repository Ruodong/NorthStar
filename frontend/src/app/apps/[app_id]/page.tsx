"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { DeploymentMap } from "@/components/DeploymentMap";
import { Pill } from "@/components/Pill";
import { CapabilitiesTab } from "./CapabilitiesTab";
import {
  AppNode,
  OutboundEdge,
  InboundEdge,
  MajorApp,
  Investment,
  DiagramRef,
  ConfluencePageRef,
  TcoData,
  ReviewPage,
  AppDetailResponse,
  ImpactApp,
  ImpactBucket,
  BusinessObjectAgg,
  ImpactResponse,
  Tab,
  STATUS_COLORS,
} from "./_shared/types";
import { Panel } from "./_shared/Panel";
import { EmptyState } from "./_shared/EmptyState";
import { Kpi } from "./_shared/Kpi";
import { StatusPill } from "./_shared/StatusPill";
import { CmdbField } from "./_shared/CmdbField";
import { TabButton } from "./_shared/TabButton";
import { CITY_LABELS } from "./_shared/cities";
import { ConfluenceTab } from "./tabs/ConfluenceTab";
import { InvestmentsTab } from "./tabs/InvestmentsTab";
import { DiagramsTab } from "./tabs/DiagramsTab";
import { KnowledgeBaseTab } from "./tabs/KnowledgeBaseTab";
import { ImpactTab } from "./tabs/ImpactTab";
import { DeploymentTab } from "./tabs/DeploymentTab";
import { OverviewTab } from "./tabs/OverviewTab";
import { IntegrationsTab } from "./tabs/IntegrationsTab";

export default function AppDetailPage() {
  const params = useParams();
  const appId = decodeURIComponent(params.app_id as string);
  const [data, setData] = useState<AppDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [deployCount, setDeployCount] = useState<number | undefined>(undefined);
  const [capCount, setCapCount] = useState<number | undefined>(undefined);

  // Fetch deployment count for tab badge (non-blocking)
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/masters/applications/${encodeURIComponent(appId)}/deployment`);
        const j = await r.json();
        if (j.success && j.data?.summary) {
          const s = j.data.summary;
          setDeployCount(s.servers + s.containers + s.databases + (s.object_storage || 0) + (s.nas || 0));
        }
      } catch { /* non-blocking */ }
    })();
  }, [appId]);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const res = await fetch(`/api/graph/nodes/${encodeURIComponent(appId)}`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          if (!cancelled) setErr("not-found");
          return;
        }
        if (!res.ok) throw new Error(`${res.status}`);
        const j = await res.json();
        if (!j.success) throw new Error(j.error || "API error");
        if (!cancelled) setData(j.data as AppDetailResponse);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appId]);

  if (loading) {
    return <LoadingState appId={appId} />;
  }
  if (err === "not-found") {
    return <NotFoundState appId={appId} />;
  }
  if (err || !data) {
    return (
      <div style={{ padding: 40, color: "var(--error)" }}>
        Failed to load: {err || "unknown error"}
      </div>
    );
  }

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
        <div style={{ display: "flex", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
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
        <TabButton current={tab} value="deployment" onClick={setTab}
          count={deployCount}>
          Deployment
        </TabButton>
        <TabButton current={tab} value="impact" onClick={setTab}>
          Impact Analysis
        </TabButton>
        <TabButton current={tab} value="investments" onClick={setTab} count={investments.length}>
          Investments
        </TabButton>
        <TabButton current={tab} value="diagrams" onClick={setTab} count={diagrams.length}>
          Diagrams
        </TabButton>
        <TabButton current={tab} value="confluence" onClick={setTab} count={reviewCount}>
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

// (ImpactTab + DistanceBucket + BOBar moved to ./tabs/ImpactTab.tsx in PR 2 step 2d)
// -----------------------------------------------------------------------------
// Subcomponents
// (TabButton, StatusPill, CmdbField, Panel, EmptyState moved to _shared/
//  in PR 2 step 2c — see REFACTOR-INVENTORY.md)
// -----------------------------------------------------------------------------

// (OverviewTab + EaStandardsPanel + LifeCycleChangePanel + LifecycleRow + yearOfGoLive moved to ./tabs/OverviewTab.tsx in PR 2 step 2d)
// (IntegrationsTab + 17 helpers/interfaces/constants moved to ./tabs/IntegrationsTab.tsx in PR 2 step 2d — ~2100 lines)
// ---------------- Error states ----------------
function LoadingState({ appId }: { appId: string }) {
  return (
    <div style={{ padding: 40, color: "var(--text-dim)", fontSize: 13 }}>
      Loading {appId}…
    </div>
  );
}

function NotFoundState({ appId }: { appId: string }) {
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
      <div style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
        No application with id <code style={{ fontFamily: "var(--font-mono)" }}>{appId}</code> exists in
        the graph.
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

// ---------------- Confluence Review Pages ----------------
// (ConfluenceTab moved to ./tabs/ConfluenceTab.tsx in PR 2 step 2d)

// (KnowledgeBaseTab moved to ./tabs/KnowledgeBaseTab.tsx in PR 2 step 2d)

// (DeploymentTab + DeployKpi + EnvBadge + ZoneBadge + DeployStatusPill + cityLabel moved to ./tabs/DeploymentTab.tsx in PR 2 step 2d)

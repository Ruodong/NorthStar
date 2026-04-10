import Link from "next/link";

export default function Home() {
  return (
    <div>
      <div style={{ marginBottom: 48 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: 0.7,
            color: "var(--accent)",
            marginBottom: 14,
          }}
        >
          IT Operational Command System
        </div>
        <h1
          style={{
            fontSize: 44,
            lineHeight: 1.1,
            letterSpacing: -0.5,
            maxWidth: 820,
            marginBottom: 18,
          }}
        >
          A navigable knowledge graph of your IT architecture.
        </h1>
        <p
          className="subtitle"
          style={{ fontSize: 16, maxWidth: 720 }}
        >
          NorthStar extracts structured data from draw.io architecture diagrams
          across fiscal years, builds an Ontology of applications and their
          integrations in Neo4j, and surfaces it as a queryable graph, analytics
          dashboard, and ingestion console.
        </p>
      </div>

      <div className="panel-grid">
        <FeatureCard
          tag="01"
          title="Management Dashboard"
          body="KPIs, status distribution, fiscal-year change trends, integration hubs, and AI-assessed architecture quality scores."
          href="/dashboard"
          cta="Open dashboard"
        />
        <FeatureCard
          tag="02"
          title="Asset Graph"
          body="Force-directed graph of every application and its integrations. Search, filter by status and fiscal year, drill into details."
          href="/graph"
          cta="Open graph"
        />
        <FeatureCard
          tag="03"
          title="Ingestion Console"
          body="Trigger Confluence ingestion runs, monitor task progress in real time, and review AI quality evaluation per project."
          href="/ingestion"
          cta="Open ingestion"
          full
        />
      </div>

      <div
        style={{
          marginTop: 56,
          paddingTop: 24,
          borderTop: "1px solid var(--border)",
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 24,
        }}
      >
        <Stat label="Data source" value="draw.io / Confluence" />
        <Stat label="Graph engine" value="Neo4j CE" />
        <Stat label="Entities" value="Application · Project" />
        <Stat label="Quality eval" value="AI + rule-based" />
      </div>
    </div>
  );
}

function FeatureCard({
  tag,
  title,
  body,
  href,
  cta,
  full,
}: {
  tag: string;
  title: string;
  body: string;
  href: string;
  cta: string;
  full?: boolean;
}) {
  return (
    <div className={`panel${full ? " full" : ""}`} style={{ padding: 28 }}>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--accent)",
          marginBottom: 14,
          letterSpacing: 0.5,
        }}
      >
        {tag}
      </div>
      <h2 style={{ fontSize: 20, marginBottom: 10 }}>{title}</h2>
      <p
        style={{
          color: "var(--text-muted)",
          fontSize: 13,
          lineHeight: 1.6,
          marginBottom: 24,
          maxWidth: 560,
        }}
      >
        {body}
      </p>
      <Link href={href} className="btn">
        {cta} <span style={{ marginLeft: 2 }}>→</span>
      </Link>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: 0.7,
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 13,
          color: "var(--text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

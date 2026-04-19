"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useTabFetch } from "../_shared/useTabFetch";

// -----------------------------------------------------------------------------
// Types — mirror backend AppBusinessCapabilitiesResponse (api.md §6)
// -----------------------------------------------------------------------------
interface BusinessCapabilityLeaf {
  bc_id: string;
  bc_name: string;
  bc_name_cn: string | null;
  bc_description: string | null;
  level: number;
  lv3_capability_group: string;
  biz_owner: string | null;
  biz_team: string | null;
  dt_owner: string | null;
  dt_team: string | null;
  data_version: string | null;
  source_updated_at: string | null;
}

interface CapabilityL2Group {
  l2_subdomain: string;
  leaves: BusinessCapabilityLeaf[];
}

interface CapabilityL1Group {
  l1_domain: string;
  count: number;
  l2_groups: CapabilityL2Group[];
}

interface AppBusinessCapabilitiesResponse {
  app_id: string;
  total_count: number;
  l1_groups: CapabilityL1Group[];
  taxonomy_versions: string[];
  last_synced_at: string | null;
  orphan_mappings: number;
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------
function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const h = Math.floor(diffMs / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function ownerLine(leaf: BusinessCapabilityLeaf): string | null {
  const hasAny =
    leaf.biz_owner || leaf.biz_team || leaf.dt_owner || leaf.dt_team;
  if (!hasAny) return null;
  const biz = leaf.biz_owner
    ? `${leaf.biz_owner}${leaf.biz_team ? ` (${leaf.biz_team})` : ""}`
    : "—";
  const dt = leaf.dt_owner
    ? `${leaf.dt_owner}${leaf.dt_team ? ` (${leaf.dt_team})` : ""}`
    : "—";
  return `Biz: ${biz} · DT: ${dt}`;
}

// -----------------------------------------------------------------------------
// Tree model (flat sequence of visible nodes — one source of truth for
// keyboard navigation).
// -----------------------------------------------------------------------------
type TreeNodeKind = "l1" | "l2" | "l3";

interface TreeNode {
  key: string;
  kind: TreeNodeKind;
  level: 1 | 2 | 3;
  /** Key of the parent node. Root items have null parent. */
  parentKey: string | null;
  /** True if this node has children (L1 / L2) — arrow keys expand/collapse. */
  expandable: boolean;
  label: string;
  /** L1/L2 count OR L3 bc_id prefix. */
  meta: string | null;
  /** L3 leaf details, only set for L3. */
  leaf?: BusinessCapabilityLeaf;
}

function buildFlatTree(
  data: AppBusinessCapabilitiesResponse,
  collapsed: Set<string>,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const l1 of data.l1_groups) {
    const l1Key = `l1:${l1.l1_domain}`;
    const l1Closed = collapsed.has(l1Key);
    out.push({
      key: l1Key,
      kind: "l1",
      level: 1,
      parentKey: null,
      expandable: true,
      label: l1.l1_domain || "(no domain)",
      meta: String(l1.count),
    });
    if (l1Closed) continue;

    for (const l2 of l1.l2_groups) {
      const l2Key = `l2:${l1.l1_domain}||${l2.l2_subdomain}`;
      const l2Closed = collapsed.has(l2Key);
      out.push({
        key: l2Key,
        kind: "l2",
        level: 2,
        parentKey: l1Key,
        expandable: true,
        label: l2.l2_subdomain || "(no subdomain)",
        meta: String(l2.leaves.length),
      });
      if (l2Closed) continue;

      l2.leaves.forEach((leaf, idx) => {
        const l3Key = `l3:${l1.l1_domain}||${l2.l2_subdomain}||${leaf.bc_id}||${idx}`;
        const hasDetails = !!(leaf.bc_name_cn || ownerLine(leaf));
        out.push({
          key: l3Key,
          kind: "l3",
          level: 3,
          parentKey: l2Key,
          expandable: hasDetails,
          label: leaf.bc_name,
          meta: leaf.bc_id,
          leaf,
        });
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------------
export function CapabilitiesTab({ appId }: { appId: string }) {
  const { data, loading, err } = useTabFetch<AppBusinessCapabilitiesResponse>(
    appId ? `/api/apps/${encodeURIComponent(appId)}/business-capabilities` : null,
    [appId],
  );

  // Collapse state per key. Default (absent) = expanded for L1/L2, collapsed for L3.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // Single focus point for roving tabindex. First L1 by default.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);

  const itemRefs = useRef(new Map<string, HTMLDivElement | null>());

  const toggle = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const flatTree = useMemo(
    () => (data ? buildFlatTree(data, collapsed) : []),
    [data, collapsed],
  );

  // Normalize focus: if focusedKey dropped out of the visible set (user
  // collapsed an ancestor while focus was on a descendant), move focus
  // up to the closest visible ancestor. This is plan §14 F8's "focus
  // loss in tree" failure mode — covered here.
  const effectiveFocusKey: string | null = useMemo(() => {
    if (flatTree.length === 0) return null;
    if (!focusedKey) return flatTree[0].key;
    if (flatTree.some((n) => n.key === focusedKey)) return focusedKey;
    // Walk up parents until we find a visible one, else pick first item.
    const parentChain = (k: string) => k.split("||").slice(0, -1).join("||");
    let probe = focusedKey;
    // L3 collapsed by parent → fall back to parent L2, then L1.
    if (probe.startsWith("l3:")) {
      probe = `l2:${parentChain(probe.slice(3))}`;
    }
    if (probe.startsWith("l2:") && !flatTree.some((n) => n.key === probe)) {
      probe = `l1:${probe.slice(3).split("||")[0]}`;
    }
    if (flatTree.some((n) => n.key === probe)) return probe;
    return flatTree[0].key;
  }, [focusedKey, flatTree]);

  const focusKey = useCallback((key: string) => {
    setFocusedKey(key);
    queueMicrotask(() => {
      itemRefs.current.get(key)?.focus();
    });
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>, node: TreeNode) => {
      const idx = flatTree.findIndex((n) => n.key === node.key);
      if (idx === -1) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (idx < flatTree.length - 1) focusKey(flatTree[idx + 1].key);
          break;
        case "ArrowUp":
          e.preventDefault();
          if (idx > 0) focusKey(flatTree[idx - 1].key);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (node.expandable && collapsed.has(node.key)) {
            toggle(node.key); // expand
          } else if (idx < flatTree.length - 1) {
            // Move to first child — which, since flatTree is DFS-ordered
            // and the node is already expanded, is flatTree[idx+1] when
            // it's a descendant of the current node.
            const maybeChild = flatTree[idx + 1];
            if (maybeChild.level > node.level) focusKey(maybeChild.key);
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (node.expandable && !collapsed.has(node.key)) {
            toggle(node.key); // collapse
          } else if (node.parentKey) {
            focusKey(node.parentKey);
          }
          break;
        case "Home":
          e.preventDefault();
          focusKey(flatTree[0].key);
          break;
        case "End":
          e.preventDefault();
          focusKey(flatTree[flatTree.length - 1].key);
          break;
        case "Enter":
        case " ":
          if (node.expandable) {
            e.preventDefault();
            toggle(node.key);
          }
          break;
      }
    },
    [flatTree, collapsed, toggle, focusKey],
  );

  // ---- Render states ----
  if (loading) {
    return (
      <div style={{ color: "var(--text-dim)", fontSize: 13, padding: 12 }}>
        Loading capabilities…
      </div>
    );
  }
  if (err) {
    return (
      <div
        role="alert"
        style={{
          color: "var(--error)",
          fontSize: 13,
          padding: 12,
          border: "1px solid color-mix(in srgb, var(--error) 30%, transparent)",
          borderRadius: 4,
        }}
      >
        Failed to load capabilities: {err}
      </div>
    );
  }
  if (!data) return null;

  const isEmpty = data.total_count === 0;
  const mixedVersions = data.taxonomy_versions.length > 1;

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {isEmpty ? (
        <div
          style={{
            textAlign: "center",
            padding: "48px 24px",
            color: "var(--text-muted)",
            fontSize: 13,
            lineHeight: 1.6,
            border: "1px dashed var(--border-strong)",
            borderRadius: 6,
          }}
        >
          <div style={{ fontSize: 15, color: "var(--text)", marginBottom: 8 }}>
            No business capabilities mapped
          </div>
          <div style={{ maxWidth: 480, margin: "0 auto" }}>
            This application hasn&apos;t been mapped to any business
            capability in EAM yet. Mapping is maintained in EAM by the
            Enterprise Architecture team.
          </div>
        </div>
      ) : (
        <div
          role="tree"
          aria-label="Business capabilities"
          style={{
            border: "1px solid var(--border-strong)",
            borderRadius: 4,
            overflow: "hidden",
          }}
        >
          {flatTree.map((node) => (
            <TreeItem
              key={node.key}
              node={node}
              expanded={node.expandable ? !collapsed.has(node.key) : undefined}
              focused={node.key === effectiveFocusKey}
              onToggle={() => toggle(node.key)}
              onKeyDown={(e) => handleKeyDown(e, node)}
              onFocus={() => setFocusedKey(node.key)}
              elRef={(el) => {
                itemRefs.current.set(node.key, el);
              }}
            />
          ))}
        </div>
      )}

      {/* Footer meta */}
      <div
        style={{
          borderTop: "1px solid var(--border-strong)",
          paddingTop: 8,
          fontSize: 11,
          color: "var(--text-dim)",
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <span>Source: EAM</span>
        <span>Last sync: {relativeTime(data.last_synced_at)}</span>
        {data.taxonomy_versions.length > 0 && (
          <span>
            Taxonomy {data.taxonomy_versions.map((v) => `v${v}`).join("/")}
            {mixedVersions && (
              <span style={{ color: "var(--accent)", marginLeft: 6 }}>
                ⚠ mixed versions
              </span>
            )}
          </span>
        )}
        {data.orphan_mappings > 0 && (
          <span style={{ color: "var(--text-muted)" }}>
            ({data.orphan_mappings} orphan mapping
            {data.orphan_mappings === 1 ? "" : "s"} filtered)
          </span>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// TreeItem — single row in the tree. Renders L1 / L2 / L3 variants from
// the same component so the keyboard handler only has to deal with one
// shape.
// -----------------------------------------------------------------------------
interface TreeItemProps {
  node: TreeNode;
  /** true=expanded, false=collapsed, undefined=leaf with no children. */
  expanded: boolean | undefined;
  focused: boolean;
  onToggle: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  elRef: (el: HTMLDivElement | null) => void;
}

function TreeItem({
  node,
  expanded,
  focused,
  onToggle,
  onKeyDown,
  onFocus,
  elRef,
}: TreeItemProps) {
  const indent = node.level === 1 ? 14 : node.level === 2 ? 30 : 46;
  const fontSize = node.level === 3 ? 13 : node.level === 2 ? 12 : 13;
  const fontWeight = node.level === 1 ? 600 : node.level === 2 ? 500 : 400;
  const background =
    node.level === 1
      ? "color-mix(in srgb, var(--surface) 40%, transparent)"
      : "transparent";
  const borderTop =
    node.level === 1
      ? "1px solid var(--border-strong)"
      : "1px solid color-mix(in srgb, white 4%, transparent)";

  const caret = expanded === undefined ? "" : expanded ? "▾" : "▸";

  const oline = node.leaf ? ownerLine(node.leaf) : null;
  const l3DetailsVisible =
    node.kind === "l3" && expanded === true && node.leaf;

  return (
    <div
      role="treeitem"
      aria-level={node.level}
      aria-expanded={expanded}
      aria-posinset={undefined /* skipped — flatTree keeps order stable */}
      tabIndex={focused ? 0 : -1}
      ref={elRef}
      onClick={() => (node.expandable ? onToggle() : undefined)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      style={{
        display: "block",
        cursor: node.expandable ? "pointer" : "default",
        borderTop: node.kind === "l1" ? borderTop : undefined,
        background,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          padding: `${node.level === 3 ? "8" : node.level === 2 ? "8" : "10"}px 14px ${node.level === 3 ? "8" : node.level === 2 ? "8" : "10"}px ${indent}px`,
          color: "var(--text)",
          fontFamily: node.level === 3 ? "var(--font-body)" : "var(--font-display)",
          fontSize,
          fontWeight,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: "inline-block",
            width: 10,
            color: "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          {caret}
        </span>
        {node.kind === "l3" && (
          <code
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
              minWidth: 68,
              flexShrink: 0,
            }}
          >
            {node.meta}
          </code>
        )}
        <span style={{ flex: 1 }}>{node.label}</span>
        {node.kind !== "l3" && node.meta && (
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-dim)",
            }}
          >
            {node.meta}
          </span>
        )}
      </div>
      {l3DetailsVisible && node.leaf && (
        <div style={{ padding: "0 14px 10px 134px" }}>
          {node.leaf.bc_name_cn && (
            <div
              style={{
                fontStyle: "italic",
                fontSize: 11,
                color: "var(--text-muted)",
                marginTop: 2,
              }}
            >
              {node.leaf.bc_name_cn}
            </div>
          )}
          {oline && (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                marginTop: 4,
                fontFamily: "var(--font-mono)",
              }}
            >
              {oline}
            </div>
          )}
          {node.leaf.bc_description && (
            <div
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                marginTop: 4,
                lineHeight: 1.5,
              }}
            >
              {node.leaf.bc_description}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

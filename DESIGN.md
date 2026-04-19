# Design System — NorthStar

> Always read this before making any visual or UI decisions. Do not deviate without explicit approval.

## Product Context

- **What this is:** IT Operational Command System — a queryable knowledge graph of IT architecture assets (applications, integrations, projects) extracted from draw.io diagrams.
- **Who it's for:** IT management, architecture governance, enterprise operations leads.
- **Space/industry:** Enterprise IT operations, architecture tooling. Peers: Palantir Foundry, LeanIX, Ardoq, Datadog, Linear (for polish), Bloomberg Terminal (for density).
- **Project type:** Internal web application. Data-dense dashboard + graph viewer + ingestion console.

## Aesthetic Direction

**Direction:** **Orbital Ops** — precision command center with warm intelligence accents. Think mission control console crossed with a modern engineering tool. Dark base, single sharp accent, minimal decoration, maximum information per square centimeter.

- **Decoration level:** Minimal — typography and disciplined layout carry the design. No gradients, no shadows on panels, no illustrated empty states, no textured backgrounds.
- **Mood:** Calm, confident, focused. The product should feel like a cockpit instrument, not a consumer app. Scanning rewards speed. Color means something.
- **Reference feel:** Palantir Foundry (information density), Linear (type + spacing craft), Vercel dashboard (restraint), NASA mission control (amber signal color + deep dark backdrop).

## Typography

Three fonts. All loaded via Google Fonts.

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| Display / Hero | **Space Grotesk** | 500, 600 | Geometric grotesk with character. Distinctive without being weird. Section titles, page H1, large numbers in KPIs. |
| Body / UI | **Geist Sans** | 400, 500, 600 | Tight, modern, optically correct at 12-14px. Everything that isn't a display number or code. |
| Data / Code | **JetBrains Mono** | 400, 500 | Tabular figures so app IDs like `A100001` and numeric columns align. Used for IDs, code snippets, log-style output. |

**Load (in `layout.tsx`):**
```
https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600&family=Geist:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap
```

**Type scale:**

| Token | Size | Line | Font | Weight | Use |
|-------|------|------|------|--------|-----|
| `display` | 44px | 1.1 | Space Grotesk | 600 | Marketing-style hero (rare, only landing) |
| `h1` | 28px | 1.2 | Space Grotesk | 600 | Page title |
| `h2` | 18px | 1.3 | Space Grotesk | 500 | Section title |
| `h3` | 14px | 1.4 | Geist Sans | 600 | Panel title (uppercase, letter-spacing 0.6px) |
| `body` | 14px | 1.55 | Geist Sans | 400 | Default |
| `body-sm` | 13px | 1.5 | Geist Sans | 400 | Tables, captions under data |
| `caption` | 11px | 1.3 | Geist Sans | 500 | Labels, nav, uppercase, letter-spacing 0.7px |
| `kpi` | 38px | 1.0 | Space Grotesk | 600 | KPI card values, tabular-nums |
| `mono` | 13px | 1.5 | JetBrains Mono | 400 | IDs, code, raw values |

## Color

Single accent, earned use. Dark-first (this app is almost always viewed in dim rooms, long sessions).

### Base (dark)
| Token | Hex | Use |
|-------|-----|-----|
| `--bg` | `#07090d` | Page background. Deep space, not pure black. |
| `--bg-elevated` | `#0c1017` | Raised area like the nav bar strip. |
| `--surface` | `#0f131c` | Panels, cards. |
| `--surface-hover` | `#151a24` | Hover/active row in tables, hovered card. |
| `--border` | `#1c2230` | Subtle borders. |
| `--border-strong` | `#2a3142` | Focused/selected borders, dividers. |

### Text
| Token | Hex | Use |
|-------|-----|-----|
| `--text` | `#e7eaf0` | Primary text. Not pure white — reduces eye strain. |
| `--text-muted` | `#9aa4b8` | Secondary, captions, meta. |
| `--text-dim` | `#5f6a80` | Disabled, placeholders, tertiary data. |

### Accent (THE color — the NorthStar)
| Token | Hex | Use |
|-------|-----|-----|
| `--accent` | `#f6a623` | Primary action buttons, active nav, focused state, the star in the brand. |
| `--accent-hover` | `#ffb63a` | Button hover. |
| `--accent-dim` | `#3a2a0a` | Low-opacity accent wash for selected backgrounds. |

### Status (data-driven — muted so they don't fight the accent)
| Status | Hex | Semantic |
|--------|-----|----------|
| Keep | `#6ba6e8` | Stable baseline — cool blue |
| Change | `#e8b458` | Attention, in-flight — warm amber |
| New | `#e8716b` | Emergence, fresh — coral |
| Sunset | `#6b7488` | Fading — slate |
| 3rd Party | `#a8b0c0` | External — neutral light |

### UI states
| Token | Hex | Use |
|-------|-----|-----|
| `--success` | `#5fc58a` | Success toasts, "completed" pills |
| `--warning` | `#f6a623` | Same as accent — deliberate |
| `--error` | `#e8716b` | Error states, failed tasks |
| `--info` | `#6ba6e8` | Info pills, neutral notifications |

## Spacing

Base unit: **4px**. Scale is tight — this is a density product.

| Token | px |
|-------|----|
| `2xs` | 2 |
| `xs`  | 4 |
| `sm`  | 8 |
| `md`  | 12 |
| `lg`  | 16 |
| `xl`  | 20 |
| `2xl` | 28 |
| `3xl` | 40 |
| `4xl` | 56 |
| `5xl` | 80 |

## Layout

- **Max content width:** 1440px
- **Gutter:** 32px on desktop, 16px on mobile
- **Panel grid:** CSS grid, 12 columns at ≥1100px, 1 column below
- **Nav:** 56px tall, sticky, bottom border `1px solid --border-strong`
- **Border radius:** sharp
  - `--radius-sm` `2px` — pills, tags
  - `--radius-md` `4px` — buttons, inputs
  - `--radius-lg` `6px` — panels, cards
  - No `border-radius: 999px` blobs. Pills get 2px.
- **No shadows on panels.** Depth is created by `border-color`, not blur. The only shadow is on focused inputs (`0 0 0 2px var(--accent-dim)`).

## Motion

Minimal functional. Motion that doesn't aid comprehension is cut.

- **Easing:** `cubic-bezier(0.4, 0, 0.2, 1)` for everything.
- **Duration:** hovers 120ms, state changes 180ms, nothing longer.
- **No entrance animations on data.** Tables, KPIs, graphs do not fade in. They appear.
- **Focused input:** 120ms border-color + box-shadow.
- **Graph selection:** instant. No lerp-in.

## Components (principles)

- **Nav:** Top sticky, brand left (`★ NorthStar` — the star is literal), links right. Active link gets a 2px amber underline.
- **KPI card:** Flat panel. Left edge 2px amber stripe. Label in caption above the value. Value in `kpi` type (Space Grotesk 38px, tabular-nums). No icon.
- **Panel:** `1px solid --border`, `--radius-lg`, 20px padding. Title in `h3` (uppercase, letter-spacing). No decorative header bar.
- **Button primary:** amber fill, black text, `--radius-md`, 9px 18px, `font-weight: 600`, no shadow. Hover: `--accent-hover`.
- **Button secondary:** transparent fill, 1px `--border-strong`, text color `--text`. Hover: `--surface-hover`.
- **Input / select:** `--bg-elevated` bg, 1px `--border-strong`, 8px 12px, 13px font, focused gets 2px amber ring.
- **Table:** no zebra. 1px bottom border on rows. Header: caption style, uppercase, `--text-muted`. IDs in JetBrains Mono. Numeric columns right-aligned with `font-variant-numeric: tabular-nums`.
- **Status pill:** 2px radius, 11px caption, bg uses status color at ~15% opacity, text uses status color at full. Four corners, no bubble.
- **Graph node:** filled circle in status color, 2px dark border for definition. Selected: 3px amber outer ring, no scale.

## Differentiation (deliberate risks)

1. **Amber (`#f6a623`) instead of blue/purple as the primary accent.** Every IT dashboard is blue; every startup SaaS is purple. Amber reads as "signal" (mission control, ATC, trading terminals) and semantically fits the "NorthStar" brand. Risk: slightly warmer than the enterprise norm. Worth it for the instant recognizability.
2. **Sharp 2-6px radii instead of 8-12px.** Most modern UIs are heading toward rounder, "friendlier" shapes. NorthStar deliberately goes the other way — instrument panel, not consumer app. Risk: feels colder. That's the point — this is a serious tool for IT management.
3. **Three-font stack with Space Grotesk display.** Inter-only is safe and boring. Space Grotesk gives KPIs and page titles genuine character without going unreadable. JetBrains Mono for data is non-negotiable because app IDs need tabular alignment.
4. **No icons in KPI cards, no illustrations anywhere.** The temptation is always to add a little rocket or chart icon. Skipping all of it forces the typography to carry the weight — and it does.

## App Detail Redesign Extensions

> Added 2026-04-18 as part of the App Detail page redesign (`.specify/features/app-detail-redesign/`). Extends the foundations above with detail-page-specific patterns. Patterns documented here apply to **every entity detail page** going forward (`/apps/[id]`, future `/projects/[id]`, `/capabilities/[id]`).

### Motion — Detail Page Specifics

Extends the general Motion section above. The general principles still apply (180ms ceiling, single easing curve, no decorative motion); these are the specific cases the App Detail page covers.

- **Tab switch:** instant, no fade. Switching tabs is a navigation action, not a state transition.
- **Lazy-load content fade-in:** 120ms, content area only. This is the *one* exception to "no entrance animations on data" — it's a UX signal that the just-fetched payload has arrived. Already-on-screen data (KPIs, the AnswerBlock, the title row) still appears, never fades.
- **Collapse / expand:** 100ms height transition. Used by `CapabilityTree` (L1 / L2 / L3 toggle), and any future tree primitive.
- **No bounces, no springs, no decorative motion.**

### Interaction States

Every fetched data section renders one of five states. Style is consistent across the product so architects can scan quickly.

| State | Style |
|-------|-------|
| `loading` | `Loading <noun>…` in `var(--text-dim)`, 13px Geist, 12px padding-block. No skeleton bones. |
| `empty` | Centered card, 1px dashed `var(--border-strong)`, 48×24 padding, 15px title in `var(--text)` + 13px body in `var(--text-muted)`. No CTA unless the action is meaningful (linking to the data source counts as meaningful). |
| `error` | Red banner inline at the affected section (NOT page-wide), 1px solid `rgba(232,113,107,0.3)`, 4px radius, 13px body in `var(--error)`. |
| `partial` | Same surface as the success state, with a footer note in `var(--text-muted)` reading `(N rows filtered)` or `(showing N of M)`. Architects need to see *that* something was filtered, not just the filtered result. |
| `degraded` | Used when an entity is in the graph but not in CMDB. Surface renders normally; affected sections show their `empty` state with copy `Requires CMDB linkage.`. The AnswerBlock surfaces a single `Limited info — found in graph data, not in CMDB.` strip. |

### Responsive

NorthStar is desktop-only. ≥1024px supported. Below 1024 shows a single "Use a desktop browser" placeholder.

| Breakpoint | Behavior |
|-----------|----------|
| 1440 | Design baseline. 4 columns of metadata fit; full tab row visible without wrap. |
| 1280 | Panels collapse from 4 cols → 3 cols. Tab nav inter-group gap 56→32. Tab nav intra-group gap 18→12. |
| 1024 | Panels collapse from 3 cols → 2 cols. If the 3-group tab nav still overflows, fall back to horizontal scroll on the tab strip (no wrap, no hamburger). |
| <1024 | Single placeholder page. No mobile design exists or is planned. |

### Accessibility

Detail pages must pass axe-core AA in the E2E suite. The patterns below are the minimum bar.

- **Focus:** outline `1px solid var(--accent)`, outline-offset `2px`, on `:focus-visible` only. Mouse focus never shows the outline.
- **Skip link:** lives in `frontend/src/app/layout.tsx` (NOT per-page), as the first child of `<body>`, before `<nav>`. Markup: `<a className="sr-only focus:not-sr-only" href="#main-content">Skip to main content</a>`. The existing `<main className="main">` adds `id="main-content"`. Pages MUST NOT add a second `<main>`.
- **Landmarks:** `<nav aria-label="Primary">` on the global nav. Single `<main id="main-content">` per page.
- **Tab pattern:** every tabbed UI uses `role="tablist"` / `role="tab"` / `role="tabpanel"`, with arrow-key navigation (←/→ within a list, Home/End to jump to first/last) and **roving tabindex** (active tab `tabindex={0}`, others `tabindex={-1}`). `aria-controls` on each tab points at the panel id. `aria-selected` reflects active state.
- **Tree pattern:** hierarchical lists use `role="tree"` with `role="treeitem"` + `aria-level={1|2|3}` + `aria-expanded` on each item. Arrow keys: ↑/↓ moves focus, → expands or descends, ← collapses or ascends. **Roving tabindex** required (focus loss inside a long tree is the failure mode that makes a11y unusable).
- **Contrast:** WCAG AA minimum, verified by `@axe-core/playwright` in the E2E suite. Status colors (green/blue/amber/red) at full opacity on dark surfaces all clear AA at 13px+; do not use them at <13px.
- **Collapsibles:** `aria-expanded` reflects state. `aria-controls` points at the content region's `id`.

### Component Primitives

The detail page is built from a small set of shared primitives. Reuse, don't reinvent.

**Existing — reuse as-is:**

- **`Pill`** — `frontend/src/components/Pill.tsx`. Status / metadata pill. Add semantic shorthand variants (`tone="green"|"blue"|"amber"|"red"|"gray"`) if not already supported (~10 lines). Semantics:
  - `green` — active / live
  - `amber` — investment / under review
  - `red` — sunset / decommissioned
  - `blue` — classification / tag (no judgment, supports multi-meaning like CIO/CDTO)
  - `gray` — neutral metadata (no judgment)
- **`Panel`** — promoted to `frontend/src/components/Panel.tsx` if used by ≥2 places (per PR 2 inventory step). 1px solid `var(--border)`, 6px radius, 20px padding, no shadow.

**New — created in PR 3:**

- **`AnswerBlock`** — `frontend/src/components/AnswerBlock.tsx`. Above-the-fold answer surface on every entity detail page.
  - Layout: title row (`app_id` mono dim + `name` h1 + status pills inline + activity timestamp right-aligned) → CMDB indicator (mono 11px green `✓ cmdb-linked` or red `✗ not in cmdb`) → purpose line (body, 1-2 lines, `short_description` truncated to first sentence with fallback to `(no description)`) → KPI anchor row (3 numbers in `kpi` type, `tabular-nums`, format: `**N** integrations · **N** capabilities · **N** investments`) → 3-row metadata (Last change · Owners · Geo).
  - Receives ALL data via props (no internal fetch). Page.tsx (RSC) fetches + passes through.
  - Handles both `cmdb_linked === false` and `cmdb_linked === undefined` (different copy: `false` → "not in CMDB", `undefined` → "CMDB status unknown"). Non-CMDB graph-only apps degrade gracefully across owners / geo / posture, not just deployment / TCO.
  - Use on: `/apps/[id]`, future `/projects/[id]`, `/capabilities/[id]`.

- **`MetadataList`** — `frontend/src/components/MetadataList.tsx`. Dense definition list, no card chrome.
  - 2-column grid. Label = `caption` 11px Geist 500 uppercase letter-spacing 0.7px `var(--text-dim)`. Value = `body` 14px Geist `var(--text)`.
  - Spacing: 8px row gap, 24px column gap. No borders, no panels, no per-row chrome.
  - Replaces the old "4-panel mosaic" pattern on Overview.

**Pattern, not a component:**

- **`CapabilityTree`** — 3-level collapsible (L1 / L2 / L3 leaf). Reference impl: `frontend/src/app/apps/[app_id]/tabs/CapabilitiesTab.tsx` (post-PR-2 location). All three levels share font family (`display`) and color (`var(--text)`); size descends 13/12/13. Count badges (mono, `var(--text-dim)`) right-aligned on L1 + L2. L3 leaf folds owner + CN subtitle when collapsed. Full ARIA tree + keyboard navigation per the Accessibility section above.

- **`CountBadge`** — accompanies tab labels and tree node labels. Lives inline in `TabButton`, no standalone component. Mono 11px `var(--text-dim)`, 4px left margin from the label text. **Hide rule: when `count == null || count === 0`** (both `null` and `undefined`).

### CJK Font Fallback

Update the body font stack to include CJK fallbacks (Lenovo internal users frequently view Chinese content). Apply in `frontend/src/app/globals.css`:

```css
font-family: 'Geist', 'PingFang SC', 'Noto Sans SC', system-ui, sans-serif;
```

Display font (Space Grotesk) does not get a CJK fallback — page titles and KPIs are English-only by product convention.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-10 | Initial design system created | Orbital Ops direction for IT command center aesthetic. Dark base + amber accent + Space Grotesk display. |
| 2026-04-18 | App Detail Redesign Extensions section added (Motion, Interaction States, Responsive, Accessibility, Component Primitives, CJK Font Fallback) | First entity detail page (App Detail) needed shared patterns documented before redesign PRs land. Patterns apply forward to all entity detail pages. |

# Frontend — NorthStar Next.js 14

See root `CLAUDE.md` for project-wide rules. This file only covers frontend-specific conventions.

- **Next.js 14.2.18 + React 18.3.1 + TypeScript**, container port 3000 → host 3003. (Pinned to 14/18 for App Router + RSC stability. Upgrade to Next 15 / React 19 is a separate decision, not an assumption.)
- **No UI library.** No Ant Design, no MUI, no shadcn. Components are hand-written with inline styles referencing CSS custom properties from `src/app/globals.css`. If you see yourself reaching for `import { Button } from '...'`, stop — write the button inline.
- **Design system:** read `/DESIGN.md` (repo root) before any visual change. Orbital Ops — dark base, single amber accent `#f6a623`, sharp 2-6px radii, no gradients, no illustrations. Detail pages (app/project/capability) additionally follow the **App Detail Redesign Extensions** section in DESIGN.md (Motion, Interaction States, Responsive, Accessibility, Component Primitives, CJK Font Fallback).
- **Fonts:** Google Fonts loaded in `src/app/layout.tsx` — Space Grotesk (display), Geist (body), JetBrains Mono (code/IDs). Body stack includes CJK fallback (`'PingFang SC', 'Noto Sans SC'`). Use the `--font-display` / `--font-body` / `--font-mono` CSS custom properties, not hardcoded family names.
- **RSC + client boundary for entity detail pages:** `/apps/[app_id]/page.tsx` is a **Server Component** that calls `fetchAppDetail()` from `src/lib/api-server.ts`, then hands the data to `AppDetailClient.tsx`. Server-only fetch wrappers live in `src/lib/api-server.ts` (guarded by `import "server-only"`). Each tab lives in `apps/[app_id]/tabs/*.tsx` as its own client component, sharing primitives via `apps/[app_id]/_shared/`.
- **API clients:**
  - Client-side: `src/lib/api.ts` (`get`, `post`, `ApiResponse<T>` wrapper).
  - Server-side (RSC only): `src/lib/api-server.ts` (backed by `process.env.BACKEND_URL`, docker-compose sets it to `http://host.docker.internal:8001`).
  - Backend returns **snake_case** — TypeScript interfaces match snake_case, no camelCase conversion.
- **Shared primitives (app-wide):** `src/components/` — `Pill` (semantic tone variants including green/amber/red/blue/gray shorthand), `AnswerBlock`, `MetadataList`, `DeploymentMap`, `CommandPalette`, `NavLinks`, `Pager`, `StarMark`.
- **App-detail-local primitives:** `src/app/apps/[app_id]/_shared/` — `Panel`, `EmptyState`, `Kpi`, `StatusPill`, `CmdbField`, `TabButton`, `cities.ts`, `useTabFetch` (AbortController + optional timeoutMs + ApiResponse unwrap). All tab modules use `useTabFetch` for consistency.
- **Accessibility:** detail pages carry full ARIA (`role="tablist"` + roving tabindex + `role="tab"`/`role="tabpanel"`; hierarchical lists use `role="tree"` + `role="treeitem"` with aria-level + keyboard nav). A single skip link lives in `src/app/layout.tsx` (first `<body>` child) pointing at `<main id="main-content">`. Never add a second `<main>` on a page. WCAG AA contrast is enforced by `@axe-core/playwright` in the e2e suite.
- **Dynamic app detail route:** `/apps/[app_id]` (`src/app/apps/[app_id]/page.tsx`). New deep-linkable entities follow the same `/[entity]/[id]` pattern. For 404s use Next's `notFound()` + sibling `not-found.tsx`; for fetch errors use sibling `error.tsx`.
- **Global Cmd+K palette:** `src/components/CommandPalette.tsx`, mounted in `layout.tsx`. If you add a new searchable entity type, extend the palette to include it (and wire it through `/api/search`).
- **localStorage keys:** `northstar.recentSearches` (used by CommandPalette + Cockpit home). Keep keys namespaced with `northstar.` prefix.
- **Tests:**
  - **E2E**: Playwright 1.59 at repo root (`e2e-tests/`). Run with `node_modules/.bin/playwright test` from repo root; baseURL defaults to `http://192.168.68.71:3003`. App Detail page is regression-protected by `e2e-tests/app-detail/` (aria, axe, fixtures specs).
  - **Unit**: Vitest at `frontend/vitest.config.ts`. No App Detail unit tests yet — add them next to the tabs or primitives when appropriate.
  - **axe-core**: `e2e-tests/app-detail/axe.spec.ts` scans 4 fixtures (OLMS Overview, OLMS Capabilities tree, sunset BOOS, non-CMDB Axway) for WCAG 2.0/2.1 AA violations. `IGNORED_RULES` stays empty; zero violations on merge.

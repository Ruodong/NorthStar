# Frontend — NorthStar Next.js 15

See root `CLAUDE.md` for project-wide rules. This file only covers frontend-specific conventions.

- Next.js 15 + React 19 + TypeScript, container port 3000 → host 3003
- **No UI library.** No Ant Design, no MUI, no shadcn. Components are hand-written with inline styles referencing CSS custom properties from `src/app/globals.css`. If you see yourself reaching for `import { Button } from '...'`, stop — write the button inline.
- **Design system:** read `/DESIGN.md` (repo root) before any visual change. Orbital Ops — dark base, single amber accent `#f6a623`, sharp 2-6px radii, no gradients, no illustrations.
- **Fonts:** Google Fonts loaded in `src/app/layout.tsx` — Space Grotesk (display), Geist (body), JetBrains Mono (code/IDs). Use the `--font-display` / `--font-body` / `--font-mono` CSS custom properties, not hardcoded family names.
- **API client:** `src/lib/api.ts` (`get`, `post`, `ApiResponse<T>` wrapper). Backend returns snake_case — TypeScript interfaces match snake_case, no camelCase conversion.
- **Dynamic app detail route:** `/apps/[app_id]` (`src/app/apps/[app_id]/page.tsx`). New deep-linkable entities follow the same `/[entity]/[id]` pattern.
- **Global Cmd+K palette:** `src/components/CommandPalette.tsx`, mounted in `layout.tsx`. If you add a new searchable entity type, extend the palette to include it (and wire it through `/api/search`).
- **localStorage keys:** `northstar.recentSearches` (used by CommandPalette + Cockpit home). Keep keys namespaced with `northstar.` prefix.
- **No E2E tests yet** — manual verification + `next build` inside Docker is the current check. If you add Playwright later, update root `CLAUDE.md` Testing section.

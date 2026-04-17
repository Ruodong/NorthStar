# Skill: Closed-Loop Feature Development

## Description

A unified workflow combining **Impact Assessment** and **Closed-Loop Implementation** into a single end-to-end process. Guides Claude through risk evaluation, implementation, testing, and verification.

## When to Use

Activate for: new features, code changes, bug fixes, refactors, schema changes, API changes, UI modifications.
Skip for: questions/exploration, documentation-only, test-only changes.

---

## Phase 1: Impact Assessment

Before writing any code, evaluate the blast radius and risk.

### Step 1.1 — Explore & Gather Context

1. **Parse the request**: What's being added/changed? Which area of the codebase?
2. **Explore existing patterns**: Search for similar implementations, reusable components, shared utilities
3. **Read dependency graph**: `docs/features/_DEPENDENCIES.json` — identify affected feature(s) by tables, routers, frontendPaths
4. **Read feature doc(s)**: `docs/features/<slug>.md` for affected features
5. If change touches tables/APIs in `edges` or `sharedTables`, read connected feature docs too

### Step 1.2 — Classify Impact Level

| Level | Definition | Signals |
|-------|-----------|---------|
| **L1** | UI/interaction only | Only `page.tsx`, CSS/Tailwind, component styling. No router or schema changes. |
| **L2** | Feature-local | Single router's logic or columns used only by that router. |
| **L3** | Cross-feature | Tables/APIs that other features depend on. Check `_DEPENDENCIES.json` edges. |
| **L4** | Global | Shared infrastructure (`database.py`, `auth/`, `middleware`, `api.ts`, `layout.tsx`). |

### Step 1.3 — Classify Risk Level

| Level | Definition | Signals |
|-------|-----------|---------|
| **Low** | Pure additions, no migration | New endpoints, new pages. No schema changes, no existing API shapes change. |
| **Medium** | Requires migration or changes API shape | Migration needed, API response shapes change, query behavior alters. |
| **High** | Structural changes | FK relationships, status lifecycle, RBAC permissions, historical data backfill. |

> **Note**: "new column with default + new API field" = Medium (not Low), because migration is required.

### Step 1.4 — Decision Matrix

| Risk \ Impact | L1 | L2 | L3 | L4 |
|---|---|---|---|---|
| **Low** | Auto-approve | Auto-approve | Auto-approve + note | Auto-approve + note |
| **Medium** | Auto-approve | Pause: review | Pause: review | Pause: review |
| **High** | Pause: review | Pause: review | Pause: full chain | Pause: full chain |

### Step 1.5 — Output Assessment

Use format from `docs/features/_ASSESSMENT_FORMAT.md`. For Low risk, use compact format. For Medium/High, include affected features, schema changes, affected ACs, API contracts, test impact.

### Step 1.6 — Gate

- **Low risk** → Proceed to Phase 2
- **Medium risk** → Present affected ACs + API contracts. Wait for approval.
- **High risk** → Present full dependency chain + ACs + schema changes. Wait for approval.

---

## Phase 2: Feature Documentation

### Step 2.1 — Create/Update Feature Doc

1. Template: `docs/features/_TEMPLATE.md` → `docs/features/<slug>.md`
2. Fill: Summary, Impact Assessment, Affected Files, API Endpoints, UI Behavior, Acceptance Criteria
3. Set Status to "Draft"

### Step 2.2 — Update Dependency Graph

If new tables, routers, frontend paths, or cross-feature relationships introduced:
- Update `docs/features/_DEPENDENCIES.json` (tables, routers, frontendPaths, edges, sharedTables)

---

## Phase 3: Implementation

### Step 3.0 — Implementation Strategy (L3+ only)

For cross-feature/global changes: plan phased delivery, ensure backward compatibility, document rollback plan.

### Step 3.1 — Write Code

Implement backend + frontend per feature doc acceptance criteria.

### Step 3.2 — Update Test Map

New source files → add to `scripts/test-map.json`:
- Backend router → `"api": ["api-tests/test_<name>.py"]`
- Frontend page → `"e2e": ["e2e-tests/<spec>.spec.ts"]`
- Shared infra → use `wildcards` section

### Step 3.3 — Automatic Verification

PostToolUse hook (`scripts/run-affected-tests.sh`) auto-runs affected tests after every Edit/Write. Fix failures before proceeding.

---

## Phase 4: Testing

### Step 4.1 — Write API Tests

For each backend AC: test in `api-tests/test_<module>.py` using shared fixtures from `conftest.py`. Cover happy path, errors, edge cases.

### Step 4.2 — Write E2E Tests

For each frontend AC: test in `e2e-tests/<spec>.spec.ts` using Playwright. Wait for API responses before asserting.

---

## Phase 5: Verification & Completion

### Step 5.1 — Update Feature Doc

1. Check off passing ACs
2. Fill Test Coverage + Test Map Entries sections
3. Set Status to "Implemented"

### Step 5.2 — Run Full Test Suite

```bash
python3 -m pytest api-tests/ -v --tb=short
npx playwright test --reporter=list
```

### Step 5.3 — Final Checklist

- [ ] Impact Assessment completed
- [ ] Feature doc created/updated with all ACs
- [ ] Dependency graph updated if needed
- [ ] Code implemented
- [ ] Test map updated for new files
- [ ] API tests written and passing
- [ ] E2E tests written and passing
- [ ] Feature doc status set to "Implemented"
- [ ] Full test suite passing

---

## Supporting Files

| File | Purpose |
|------|---------|
| `docs/features/_TEMPLATE.md` | Feature doc template |
| `docs/features/_DEPENDENCIES.json` | Cross-feature dependency graph |
| `docs/features/_ASSESSMENT_FORMAT.md` | Impact assessment output format reference |
| `scripts/test-map.json` | Source file → test file mapping |
| `scripts/run-affected-tests.sh` | PostToolUse hook — auto-runs affected tests |

# Skill: Closed-Loop Feature Development (v2 — TDD-Integrated)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                            CLOSED-LOOP DEVELOPMENT                                   │
│                                                                                      │
│  Phase 1           Phase 2          Phase 3           Phase 4           Phase 5       │
│  ASSESS            DOC              CODE (TDD)        E2E TEST          VERIFY        │
│  ──────────────    ─────────────    ──────────────    ──────────────    ──────────────│
│  · Explore code    · Read spec      · Backend:        · Write E2E       · Run full    │
│  · Impact level    · Identify         RED → GREEN →     tests for         test suite  │
│    (L1-L4)           sections to      REFACTOR          each frontend   · Update spec │
│  · Risk level        update         · Frontend:         AC                EN + ZH     │
│    (Low/Med/Hi)    · New feature?     Unit test       · Run Playwright  · Dead code   │
│  · Output gate       → generate       first            & fix failures     cleanup     │
│    block             spec first     · Schema gate                       · Codex review│
│                                       (if DDL)                            (L2+)       │
│                                                                                      │
│  ════════════════════════════════════════════════════════════════════════════════════  │
│  Gate Block (before any Edit/Write):                                                 │
│  Task / Phase / Impact / Risk / Spec / Spec Update / Test Plan                       │
│                                                                                      │
│  Spec files:  .specify/features/{feature}/spec.md  (EN, core logic — always read)     │
│               .specify/features/{feature}/api.md   (EN, API + tables — read on demand)│
│               .specify/features/{feature}/arch.md  (ZH, architect — diagrams & deps) │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Description

A unified workflow combining **Impact Assessment**, **Test-Driven Implementation**, and **Closed-Loop Verification** into a single end-to-end process. Guides Claude through risk evaluation, test-first coding, and verification.

**Key change from v1:** Phase 3 uses TDD for all code changes (tests before implementation). E2E tests remain post-implementation in Phase 4. Backup: `.claude/skills/closed-loop-development.v1.md`.

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
4. **Read feature spec**: `.specify/features/<feature>/spec.md` — if no spec exists for this feature, check `docs/features/<slug>.md` as legacy reference
5. If change touches tables/APIs in `edges` or `sharedTables`, read connected feature specs too

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

### Step 2.1 — Create/Update Feature Spec

Template: `.specify/TEMPLATE.md` (single source of truth for spec structure).

**File layout per feature:**
- `spec.md` (EN) — core logic spec. **Always read.** Contains: Context, Key Design Decisions, FR, NFR, AC, Edge Cases, Affected Files, Test Coverage, State Machine (transition table), Out of Scope.
- `api.md` (EN) — API & data reference. **Read on demand** when task involves API endpoints or schema. Contains: API Contracts (full method/path/body/response/errors), Table Definitions (column-level detail).
- `arch.md` (ZH) — architecture view. **NOT read during normal development.** Contains: 背景, ER Diagram, Component Diagram, Sequence Diagrams, Security & Permissions, Cross-Feature Dependencies, State Machine (Mermaid diagram).

1. Read the existing spec at `.specify/features/<feature>/spec.md`
2. Identify which sections need updating
3. **If task involves API endpoints or schema**: also read `.specify/features/<feature>/api.md`
4. If spec does not exist:
   a. Read `.specify/TEMPLATE.md` for required structure
   b. Generate `spec.md`, `api.md`, and `arch.md` using `/speckit-specify` BEFORE coding (use `docs/features/<slug>.md` as input if it exists)
   c. If a legacy doc exists at `docs/features/<slug>.md`, prepend `> **ARCHIVED** — migrated to .specify/features/<feature>/spec.md` to its first line
5. Set Status to "Draft"

### Step 2.1b — Check if api.md / arch.md Need Updating

**`api.md`** update is triggered when:
- API endpoint added, removed, or signature changed → update API Contracts
- Schema columns added or changed → update Table Definitions

**`arch.md`** update is triggered when:
- Schema changes (new tables, FK changes) → update ER diagram
- New API endpoints or major restructuring → update component/sequence diagrams
- RBAC/permission changes → update security matrix
- New cross-feature dependencies → update dependency section
- State machine flow changes → update Mermaid state diagram

If none of the above apply, only update spec.md. Most bug fixes and small FR changes only touch spec.md.

### Step 2.2 — Update Dependency Graph

If new tables, routers, frontend paths, or cross-feature relationships introduced:
- Update `docs/features/_DEPENDENCIES.json` (tables, routers, frontendPaths, edges, sharedTables)

---

## Phase 3: Test-Driven Implementation

### Step 3.0 — Implementation Strategy

For all code changes: identify which tests need to be written/updated BEFORE implementation.
For L3+ cross-feature/global changes: additionally plan phased delivery, ensure backward compatibility, document rollback plan.

### Step 3.0b — Schema Change Gate (if schema/DDL involved)

**Trigger:** Any change that touches `scripts/schema.sql`, adds ALTER TABLE, CREATE TABLE, or modifies DB column usage.

**Before writing ANY schema-related code, output this extended GATE block:**

```
┌─ SCHEMA CHANGE GATE ─────────────────────────────┐
│ Column/Table: <what's being added/changed>        │
│ Migration: backend/alembic/versions/NNN_xxx.py    │
│ Backward Compatible: Yes / No (explain if No)     │
│ Default/Nullable: <DEFAULT 'x' or NULL>           │
│ Code Fallback: row.get("col") or <default>        │
│ Existing Data Impact: None / Backfill needed       │
│ Downgrade: <what downgrade() does>                │
└───────────────────────────────────────────────────┘
```

**Rules (from `docs/MIGRATION_GUIDE.md`):**
1. Additive only — NEVER DROP/RENAME column or table
2. New columns MUST be nullable or have DEFAULT
3. MUST create Alembic migration file (not manual SQL)
4. MUST update `scripts/schema.sql` to match
5. Backend code MUST use `.get()` with fallback for new columns
6. New status values MUST be added to `backend/app/models/status.py`
7. API responses MUST only add fields, never remove/rename

**If any rule is violated, STOP and fix before proceeding.**

### Step 3.1 — Update Test Map First

New source files → add to `scripts/test-map.json` BEFORE writing tests:
- Backend router → `"api": ["api-tests/test_<name>.py"]`
- Frontend page → `"e2e": ["e2e-tests/<spec>.spec.ts"]`
- Shared infra → use `wildcards` section

### Step 3.2 — TDD for Backend (per AC)

**TDD is mandatory for ALL backend code changes — new features, bug fixes, and refactors at any impact level (L1-L4).**

For **new code**: write tests first (RED → GREEN → REFACTOR).
For **modified code**: update existing tests to cover the changed behavior BEFORE changing the implementation.

Follow `superpowers:test-driven-development` with these overrides:

- **Scope:** API tests in `api-tests/test_<module>.py` using shared fixtures from `conftest.py`
- **Do NOT delete existing implementation code** — TDD "delete and restart" applies only to new code written in this phase
- **PostToolUse hook replaces manual "Verify RED/GREEN" steps** — `scripts/run-affected-tests.sh` auto-runs after every Edit/Write; still check the hook output to confirm RED/GREEN
- **Real database, no mocks** — tests hit the Docker PostgreSQL instance, not mocks

Cycle per AC (new code):
1. **RED** — Write one failing API test asserting the expected behavior
2. **Verify RED** — Confirm test fails for the right reason (feature missing, not typo)
3. **GREEN** — Write minimal backend code to pass the test
4. **Verify GREEN** — Confirm test passes, no other tests broken
5. **REFACTOR** — Clean up if needed, keep all tests green

Cycle per EC (edge cases — mandatory):
1. **RED** — Write one failing test for the edge case scenario
2. **GREEN** — Implement guard/validation to handle the edge case
3. **Verify GREEN** — Confirm test passes

> **EC testing is NOT optional.** Every EC in the spec MUST have a corresponding test. If an EC is untestable via API (e.g., frontend-only debounce), note it in the spec's Test Coverage section as "E2E only" or "untestable — reason".

Cycle for modified code:
1. **UPDATE TEST** — Modify or add test cases to cover the new expected behavior
2. **Verify RED** — Confirm updated test fails against current code
3. **IMPLEMENT** — Change the implementation to pass the updated test
4. **Verify GREEN** — Confirm all tests pass

### Step 3.2b — Refactor Gate

**Trigger:** Any refactor, simplification, or code restructuring — even "no behavior change" refactors.

Before refactoring:
1. **Run existing test suite** — `python3 -m pytest api-tests/ -v --tb=short` — record pass count
2. **List affected ACs** — Which ACs/ECs does this code implement?

After refactoring:
3. **Re-run test suite** — All previously passing tests MUST still pass
4. **Verify AC coverage** — Every AC that was covered before MUST still have a passing test
5. **If any test was deleted or modified** — Update spec Test Coverage section to reflect the change
6. **If behavior changed** — Even unintentionally, treat as "modified code" cycle above (update test first)

### Step 3.3 — TDD for Frontend

**TDD is mandatory for ALL frontend code changes that have testable logic.**

For **pure function changes** (`lib/`, `hooks/`): write or update Vitest unit tests BEFORE changing implementation.
For **component behavior changes**: write or update E2E tests in Phase 4, but identify the test cases NOW.

- Unit tests: `frontend/src/lib/__tests__/*.test.ts` using Vitest
- E2E tests: `e2e-tests/*.spec.ts` using Playwright (written in Phase 4, planned here)
- PostToolUse hook auto-verifies affected tests

### Step 3.4 — TDD Exceptions

TDD is **mandatory** for all code changes. Skip only with explicit user approval:

| Exception | When OK |
|-----------|---------|
| Schema migrations | Migration SQL isn't test-driven; test the resulting API behavior via TDD |
| Throwaway prototypes | User explicitly says "prototype" or "spike" |
| Config/env changes | No testable behavior |
| CSS-only styling | No logic to test |

---

## Phase 3.5: Dead Code Cleanup

When new code **replaces** existing functionality (not just extends it), clean up the old code before proceeding.

### Step 3.5.1 — Identify Replaced Code

Review the changes from Phase 3 and list:
- **Files** that are no longer needed (old components, configs, static data files)
- **Imports** that reference replaced modules
- **API endpoints** that are superseded by new ones
- **DB columns/tables** that are no longer read (mark for future migration, don't DROP)
- **Config entries** in `test-map.json`, `_DEPENDENCIES.json`, i18n keys

### Step 3.5.2 — Verify No Other Callers

For each candidate, confirm it's truly unused:

```bash
# Search for all references to the old file/function/endpoint
grep -r "old_module_name" --include="*.py" --include="*.ts" --include="*.tsx" backend/ frontend/src/
```

**If other callers exist:** Do NOT delete. Either update those callers too (if in scope) or leave the old code and note it as tech debt in the feature spec.

### Step 3.5.3 — Remove or Deprecate

- **Unused files:** Delete them. Git history preserves the code.
- **Unused imports:** Remove from files that were modified in Phase 3.
- **Replaced static configs** (e.g., JSON files replaced by API): Delete the file and remove its imports.
- **API endpoints replaced by new ones:** Keep for one release cycle if external consumers exist. Otherwise delete.
- **DB columns:** Never DROP in this phase. Add a comment `-- DEPRECATED: replaced by X` in schema.sql if needed.

### Step 3.5.4 — Update Mappings

- Remove deleted files from `scripts/test-map.json`
- Update `docs/features/_DEPENDENCIES.json` if routers/tables changed
- Update feature spec (`.specify/features/<feature>/spec.md`) to note what was replaced

### Step 3.5.5 — Verify Build

```bash
# Backend: check no import errors
python3 -c "import importlib; importlib.import_module('app.main')"

# Frontend: check no type errors
cd frontend && npx tsc --noEmit
```

Fix any broken imports before proceeding.

### When to Skip

- **Pure additions** (new feature, no replacement): Skip entirely
- **Bug fixes**: Skip entirely
- **Uncertain ownership**: If you're not sure whether something is used elsewhere, skip deletion and note it in the feature doc as "potential dead code"

---

## Phase 4: E2E Testing

### Step 4.1 — Write E2E Tests

For each frontend AC: test in `e2e-tests/<spec>.spec.ts` using Playwright. Wait for API responses before asserting.

### Step 4.2 — Run E2E Suite

```bash
npx playwright test e2e-tests/<spec>.spec.ts --reporter=list
```

Fix any failures before proceeding.

---

## Phase 5: Verification & Completion

### Step 5.1 — Run Full Test Suite

```bash
python3 -m pytest api-tests/ -v --tb=short
npx playwright test --reporter=list
```

All tests must pass before proceeding.

### Step 5.2 — Codex Code Review

Run `/codex review` to get an independent second opinion from a different AI system.

**When to run:**
- **L2+ changes:** Mandatory
- **L1 changes:** Optional (skip with user approval)

Codex reviews the diff and outputs a PASS/FAIL gate. If FAIL (has [P1] findings), fix the issues before proceeding.

### Step 5.3 — Codex Adversarial Challenge

Run `/codex challenge` to have Codex try to break your code — finding edge cases, race conditions, security holes, and failure modes.

**When to run:**
- **L3+ or High risk:** Mandatory
- **L2 + Medium risk:** Optional (recommend for API/schema changes)
- **L1 or L2 + Low risk:** Skip

If Codex finds critical issues, fix them and re-run the full test suite (Step 5.1).

### Step 5.4 — Update Feature Spec

1. Update affected sections in `.specify/features/<feature>/spec.md`: FR, AC, Edge Cases, Affected Files, Test Coverage
2. If API endpoints or schema changed, update `api.md` in the SAME commit
3. If the change triggers arch.md update (see Step 2.1b criteria), update `arch.md` in the SAME commit
4. Note Codex review/challenge results if applicable
5. Set Status to "Implemented"

### Step 5.5 — Test-Spec Sync Check (Mandatory)

**Before marking the task complete, verify that every AC and EC in the spec has a corresponding test:**

1. Read the spec's AC table and EC table
2. For each AC/EC, confirm a test exists in the Test Coverage section AND the test file
3. If an AC/EC is untestable (frontend-only, requires mock server), it MUST be annotated in the spec: `(E2E only)` or `(untestable — reason)`
4. If a test exists that doesn't map to any AC/EC, add it to the spec or remove it

**Output format:**
```
┌─ TEST-SPEC SYNC ──────────────────────────────┐
│ ACs: N total, N tested, N untestable, N MISSING│
│ ECs: N total, N tested, N untestable, N MISSING│
│ Missing: AC-X, EC-Y (must fix before complete) │
└────────────────────────────────────────────────┘
```

If any AC/EC is MISSING (not tested and not annotated as untestable), **STOP and write the test before proceeding.**

### Step 5.6 — Final Checklist

- [ ] Impact Assessment completed
- [ ] Feature spec created/updated with all ACs (`.specify/features/<feature>/spec.md`)
- [ ] Dependency graph updated if needed
- [ ] Test map updated for new files
- [ ] API tests written BEFORE implementation (TDD) — per AC AND per EC
- [ ] Each API test verified RED then GREEN
- [ ] Backend code implemented via TDD cycle
- [ ] Frontend code implemented
- [ ] Dead code cleanup done (if replacing existing functionality)
- [ ] E2E tests written and passing
- [ ] Full test suite passing
- [ ] Codex review passed (L2+)
- [ ] Codex challenge passed (L3+ / High risk)
- [ ] **Test-Spec Sync Check passed (Step 5.5) — zero MISSING ACs/ECs**
- [ ] Feature spec updated (`spec.md`); `api.md` updated if API/schema changed; `arch.md` updated if architecture/permissions changed

---

## Supporting Files

| File | Purpose |
|------|---------|
| `.specify/TEMPLATE.md` | Spec template (single source of truth for structure) |
| `.specify/features/<feature>/spec.md` | Core logic spec (EN) — always read |
| `.specify/features/<feature>/api.md` | API contracts + table definitions (EN) — read on demand |
| `.specify/features/<feature>/arch.md` | Architecture view (ZH) — diagrams, deps, permissions |
| `docs/features/_DEPENDENCIES.json` | Cross-feature dependency graph |
| `docs/features/_ASSESSMENT_FORMAT.md` | Impact assessment output format reference |
| `scripts/test-map.json` | Source file → test file mapping |
| `scripts/run-affected-tests.sh` | PostToolUse hook — auto-runs affected tests |
| `.claude/skills/closed-loop-development.v1.md` | v1 backup (pre-TDD) |

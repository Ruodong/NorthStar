---
name: speckit-plan
description: "Create an implementation plan from an approved spec. Use after /speckit-constitution when the spec is approved and ready for implementation. Trigger: /speckit-plan, 'plan implementation', 'create implementation plan from spec'."
---

# SpecKit Plan

Generates a structured implementation plan from an approved feature spec.

## Flow

1. Read the approved spec from `.specify/features/<feature-name>/spec.md`
2. Analyze implementation scope:
   - Backend changes (schema, migrations, routers, services)
   - Frontend changes (pages, components, hooks, API calls)
   - Test changes (API tests, E2E tests, test-map.json)
   - Configuration (seed data, system_config entries)
3. Generate plan in `docs/superpowers/plans/<date>-<feature-name>.md` with:
   - **Steps** — ordered implementation steps with dependencies
   - **Files to create/modify** — exact file paths
   - **Risk assessment** — what could go wrong, mitigation strategies
   - **Testing strategy** — which tests to write, what to verify
   - **Acceptance criteria** — how to know each step is done
4. Present plan to user for review and approval

## Plan Structure

```markdown
# Implementation Plan: <Feature Name>

## Overview
## Prerequisites
## Steps
### Step 1: <title>
- Files: ...
- Changes: ...
- Acceptance Criteria: ...
### Step 2: ...
## Testing Strategy
## Rollback Plan
## Estimated Complexity
```

## Rules

- Each step should be independently verifiable
- Steps should follow the closed-loop workflow (CLAUDE.md)
- Reference specific FR/NFR IDs from the spec
- Don't plan changes to files you haven't read

---
name: speckit-constitution
description: "Validate a spec against project standards and conventions. Use after /speckit-clarify to ensure the spec aligns with CLAUDE.md, DESIGN.md, and existing architecture. Trigger: /speckit-constitution, 'validate spec', 'check spec standards'."
---

# SpecKit Constitution

Validates a feature spec against the project's constitution (standards, conventions, architecture rules).

## Flow

1. Read the spec from `.specify/features/<feature-name>/spec.md`
2. Read project standards: `CLAUDE.md`, `DESIGN.md`, `docs/MIGRATION_GUIDE.md`
3. Validate against:
   - **Schema rules** — additive only, nullable columns, Alembic migrations required
   - **Code conventions** — camelCase responses, `require_permission()` RBAC, raw SQL via `sqlalchemy.text()`
   - **Design system** — font, color, spacing rules from `DESIGN.md`
   - **Dual-interface rule** — does this feature need `/api/agent/` endpoints?
   - **Status values** — are new statuses defined in `backend/app/models/status.py`?
   - **Testing requirements** — does the spec account for API tests and E2E tests?
   - **Closed-loop workflow** — can this spec be implemented following the mandatory workflow?
4. Report violations and recommendations
5. Update spec if user approves changes

## Rules

- This is a validation step, not a rewrite — suggest targeted fixes
- Reference specific CLAUDE.md sections when flagging violations
- Don't block on advisory items, only on mandatory violations

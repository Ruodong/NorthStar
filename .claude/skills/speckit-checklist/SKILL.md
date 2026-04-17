---
name: speckit-checklist
description: "Generate a pre-implementation checklist from a spec and plan. Use before starting implementation to verify all prerequisites are met. Trigger: /speckit-checklist, 'implementation checklist', 'pre-implementation check'."
---

# SpecKit Checklist

Generates a pre-implementation checklist ensuring all prerequisites are met before coding begins.

## Flow

1. Read the spec and plan for the feature
2. Generate checklist items:
   - [ ] Spec status is "Approved"
   - [ ] All ambiguities from `/speckit-clarify` are resolved
   - [ ] No constitution violations from `/speckit-constitution`
   - [ ] Schema migration file number is reserved
   - [ ] No conflicting changes on the branch
   - [ ] Test fixtures exist or are planned
   - [ ] Required permissions/roles are defined
   - [ ] Seed data changes are identified
   - [ ] DESIGN.md has been read (if UI changes)
   - [ ] Agent/MCP endpoints are planned (if user-facing)
3. Present checklist to user
4. Mark items as checked as user confirms each

## Rules

- Don't skip items — every checklist item must be explicitly confirmed or waived
- Block implementation start if critical items are unchecked

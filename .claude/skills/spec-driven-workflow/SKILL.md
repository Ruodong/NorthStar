---
name: spec-driven-workflow
description: "Use when the user asks to write specs before code, design a feature spec-first, or run the full specify→plan→implement pipeline. Trigger: /spec-driven-workflow, 'spec first', 'write a spec', 'spec-driven'."
---

# Spec-Driven Workflow

Orchestrates the full spec-driven development pipeline: analyze existing code → write spec → clarify ambiguities → plan implementation → generate tasks → implement.

## Flow

1. **Analyze** — Run `/speckit-analyze` to understand the current codebase state for the feature area
2. **Specify** — Run `/speckit-specify` to generate the feature spec (EN + ZH) in `.specify/features/<name>/`
3. **Clarify** — Run `/speckit-clarify` to identify and resolve ambiguities in the spec
4. **Constitution** — Run `/speckit-constitution` to validate spec against project standards
5. **Plan** — Run `/speckit-plan` to create an implementation plan
6. **Checklist** — Run `/speckit-checklist` to generate a pre-implementation checklist
7. **Tasks** — Run `/speckit-tasks` to break the plan into discrete tasks
8. **Implement** — Run `/speckit-implement` to execute each task

## Rules

- Each step MUST complete before the next begins
- User confirmation is required between Specify→Clarify and Plan→Tasks transitions
- All spec documents go in `.specify/features/<feature-name>/`
- Always generate both `spec.md` (English) and `spec.zh.md` (Chinese) versions
- Follow the template format established in existing specs (see `domain-review/spec.md` as reference)

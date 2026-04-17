---
name: speckit-from-design
description: "Convert a brainstorming design doc into SpecKit standard format (spec.md + api.md + arch.md). Use after /brainstorming produces a design spec. Trigger: /speckit-from-design, 'convert design to spec', 'design to speckit'."
---

# SpecKit From Design

Converts a brainstorming design document (`docs/superpowers/specs/*.md`) into the SpecKit three-file format under `.specify/features/<feature>/`.

## When to Use

After the brainstorming skill produces a design spec in `docs/superpowers/specs/`, run this skill to convert it into the project's standard SpecKit format before implementation.

## Flow

1. **Accept input** — path to the brainstorming design doc (or auto-detect latest in `docs/superpowers/specs/`)
2. **Read the design doc** — extract all sections
3. **Read SpecKit template** — `.specify/TEMPLATE.md` for format reference
4. **Read an existing spec** — pick one from `.specify/features/` to match style and tone
5. **Generate three files** — split design content into SpecKit structure:
   - `spec.md` (EN) — core logic spec
   - `api.md` (EN) — API & data reference
   - `arch.md` (ZH) — architecture view
6. **Save** to `.specify/features/<feature-name>/`
7. **Present summary** to user for review

## Mapping: Design Doc Section → SpecKit File

| Design Doc Section | → SpecKit File | → SpecKit Section |
|---|---|---|
| Problem / Context | spec.md | 1. Context |
| Design Principles / Key Decisions | spec.md | 1. Key Design Decisions |
| Use Cases → derive requirements | spec.md | 2. Functional Requirements |
| (infer from requirements) | spec.md | 3. Non-Functional Requirements |
| (derive from FRs) | spec.md | 4. Acceptance Criteria |
| Edge Cases | spec.md | 5. Edge Cases |
| (from implementation) | spec.md | 10. Affected Files |
| (from implementation) | spec.md | 11. Test Coverage |
| Scope Boundaries | spec.md | 13. Out of Scope |
| API section | api.md | 6. API Contracts |
| Data Model / Schema | api.md | 7. Data Models |
| (derive from data model) | api.md | 7.2 ER Diagram |
| JSONB structures | api.md | 7.3 JSONB Structures |
| (derive from architecture) | arch.md | 背景 |
| (derive from data model) | arch.md | ER 图 |
| (derive from flow) | arch.md | 组件图 + 序列图 |
| (derive from API auth) | arch.md | 安全与权限 |
| (derive from dependencies) | arch.md | 跨功能依赖 |

## Content Rules

### spec.md (EN)
- Lean and focused: "what to build and how to test"
- FR/NFR IDs: sequential, unique (FR-1, FR-2, ...; NFR-1, ...)
- AC: Given/When/Then format, each references FR/NFR IDs
- Edge Cases: ID + Scenario + Expected Behavior table
- No Mermaid diagrams in spec.md (those go in arch.md)
- Status field: `Implemented` if code already written, `Draft` if not yet

### api.md (EN)
- Full API contracts: method, path, body, response shape, error codes
- Table definitions: column, type, nullable, default, description
- ER diagram (Mermaid) showing relationships
- JSONB structure examples

### arch.md (ZH)
- Title: `# 架构视图: <English Feature Name>` — no, use `# <Feature> — 架构视图`
- Section headings in Chinese: `## 背景`, `## ER 图`, `## 组件图`, `## 序列图`
- Body text in Chinese
- Technical terms stay English: `domain review`, `governance_request`, `copied_from`
- Code, column names, API paths, Mermaid content: always English
- Include Mermaid: erDiagram, graph LR (component), sequenceDiagram
- RBAC matrix: role × operation table
- Cross-feature dependency tables

## Naming Convention

Feature name derived from design doc filename:
- `2026-04-08-copy-request-diff-design.md` → feature name: `copy-request-diff`
- Output directory: `.specify/features/copy-request-diff/`

## After Conversion

1. Inform user: "Spec converted and saved to `.specify/features/<name>/`. The original design doc at `docs/superpowers/specs/` is retained as archive."
2. Ask if user wants to proceed to `/speckit-plan` for implementation planning.

## What NOT to Do

- Do NOT delete the original design doc — it's the brainstorming record
- Do NOT invent API endpoints or DB columns not in the design doc
- Do NOT add implementation code — this is spec generation only
- If the design doc lacks info for a section, mark it as "TBD" rather than guessing
- If code is already implemented, reference actual file paths from the codebase

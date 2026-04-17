---
name: speckit-specify
description: "Generate a feature specification (spec.md + api.md + arch.md). Use after /speckit-analyze or when the user wants to write a spec for a new or existing feature. Trigger: /speckit-specify, 'write a spec', 'generate spec for', 'create feature spec'."
---

# SpecKit Specify

Generates a comprehensive feature specification as three complementary files: a core logic spec (`spec.md`, EN), an API & data reference (`api.md`, EN), and an architecture view (`arch.md`, ZH).

## Flow

1. Accept feature name and context (from user or from `/speckit-analyze` output)
2. If `/speckit-analyze` was not run, perform a quick codebase scan of the feature area
3. Generate `spec.md` (English) — core logic, always read by closed-loop
4. Generate `api.md` (English) — API contracts + table definitions, read on demand
5. Generate `arch.md` (Chinese) — architecture view for architects/stakeholders
6. Save all to `.specify/features/<feature-name>/`
7. Present a summary of the spec to the user for review

## File Split

### spec.md (EN — Core Logic, Always Read)

Read by closed-loop in every Phase 2. Must be lean and focused on "what to build and how to test."

Sections:
1. Context + Key Design Decisions
2. Functional Requirements (FR-N, grouped by subsystem)
3. Non-Functional Requirements (NFR-N)
4. Acceptance Criteria (AC-N, Given/When/Then + FR ref)
5. Edge Cases (EC-N)
6. Affected Files (backend/frontend/DB)
7. Test Coverage + Test Map (test file → AC mapping)
8. State Machine / Workflow (transition table only, no Mermaid)
9. Out of Scope / Future Considerations

### api.md (EN — API & Data Reference, Read on Demand)

Read only when the task involves API endpoints or schema changes.

Sections:
1. API Contracts (full: method/path/body/response/errors, grouped by resource)
2. Data Models — Table Definitions (column, type, nullable, default, description)

### arch.md (ZH — Architecture View, Read on Demand)

NOT read during normal closed-loop development. Updated only when schema, architecture, permissions, or cross-feature dependencies change.

Sections:
1. 背景 + 关键设计决策 (brief context in Chinese)
2. ER 图 (Mermaid erDiagram — table relationships)
3. 组件图 (Mermaid graph LR — Frontend → Backend → DB call chain)
4. 序列图 (Mermaid sequenceDiagram — key workflow interactions)
5. 安全与权限 (role × operation RBAC matrix)
6. 跨功能依赖 (depends on / depended by / shared tables)
7. 状态机 (Mermaid stateDiagram-v2 — visual state flow)

## arch.md Chinese Rules

- Title: `# 架构视图: <English Feature Name>`
- Section headings: use Chinese (e.g., `## 1. 背景`, `## 2. ER 图`)
- Body text: Chinese prose
- Technical terms: keep in English (e.g., `domain review`, `trigger expression`, `semantic_tag`, `questionnaire`)
- Code, column names, API paths, Mermaid content: always English
- Use RFC keywords in English within Chinese text (MUST, SHOULD, MAY)

## Rules

- All specs go in `.specify/features/<feature>/` — do NOT create `docs/features/*.md`
- Always read existing specs first to match style
- FR/NFR IDs must be unique and sequential within the document
- Data model must reflect actual `scripts/schema.sql` — don't invent columns
- API endpoints must reflect actual router code — don't invent endpoints
- Mark status as `Draft` until user approves, then change to `Approved`

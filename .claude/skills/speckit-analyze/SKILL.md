---
name: speckit-analyze
description: "Analyze existing codebase for a feature area before writing specs. Use when starting spec-driven development, understanding current implementation, or preparing for /speckit-specify. Trigger: /speckit-analyze, 'analyze the feature', 'understand the codebase for'."
---

# SpecKit Analyze

Performs deep codebase analysis for a feature area to inform spec writing.

## Flow

1. Ask the user which feature area to analyze (or accept as argument)
2. Search the codebase systematically:
   - Backend routers and services (`backend/app/routers/`, `backend/app/services/`)
   - Frontend pages and components (`frontend/src/app/`)
   - Database schema (`scripts/schema.sql`)
   - API tests (`api-tests/`)
   - E2E tests (`e2e-tests/`)
   - Existing specs (`.specify/features/`)
3. Document findings:
   - **Data model** — tables, columns, relationships, indexes
   - **API endpoints** — routes, methods, permissions, request/response shapes
   - **Frontend components** — pages, components, hooks, state management
   - **Business logic** — state machines, validation rules, workflows
   - **Test coverage** — existing test files and what they cover
4. Present a structured summary to the user
5. Flag any inconsistencies or gaps found

## Output

A structured analysis report (not saved to file — presented in conversation) covering:
- Current implementation status
- Key files and their roles
- Data flow diagrams (text-based)
- Gaps or inconsistencies that the spec should address

## Rules

- Use Explore agents for parallel codebase research
- Read actual code, don't guess based on file names
- Report findings factually — don't suggest changes yet

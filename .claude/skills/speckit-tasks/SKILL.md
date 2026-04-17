---
name: speckit-tasks
description: "Break an implementation plan into discrete, trackable tasks. Use after /speckit-plan to create a task list for implementation. Trigger: /speckit-tasks, 'create tasks from plan', 'break plan into tasks'."
---

# SpecKit Tasks

Converts an implementation plan into discrete, trackable tasks suitable for the TodoWrite tool or issue tracking.

## Flow

1. Read the implementation plan from `docs/superpowers/plans/`
2. Break each plan step into atomic tasks:
   - Each task should be completable in one coding session
   - Each task should have clear acceptance criteria
   - Tasks should specify which files are affected
   - Dependencies between tasks should be explicit
3. Generate task list with:
   - **ID** — sequential (T-001, T-002, ...)
   - **Title** — concise action statement
   - **Description** — what to do and why
   - **Files** — files to create/modify
   - **Depends on** — prerequisite task IDs
   - **Spec refs** — FR/NFR IDs this task implements
   - **Test** — how to verify completion
4. Present to user, load into TodoWrite for tracking

## Rules

- Tasks should be ordered so dependencies are satisfied
- Backend before frontend (APIs must exist before UI calls them)
- Schema/migration before router before service before frontend
- Each task should reference specific FR/NFR IDs from the spec
- Include test-writing tasks alongside implementation tasks

---
name: speckit-implement
description: "Execute implementation tasks from a SpecKit plan. Use after /speckit-tasks to implement features task-by-task following the closed-loop workflow. Trigger: /speckit-implement, 'implement from spec', 'start implementing tasks'."
---

# SpecKit Implement

Executes implementation tasks one by one, following the closed-loop development workflow.

## Flow

1. Read the task list (from TodoWrite or the plan file)
2. For each task, in dependency order:
   a. Output the CLOSED-LOOP GATE block (mandatory per CLAUDE.md)
   b. Read all files that will be modified
   c. Implement the changes
   d. Run affected tests (per `scripts/test-map.json`)
   e. Verify tests pass
   f. Mark task as complete
   g. Report progress to user
3. After all tasks complete, run full test suite
4. Present implementation summary

## Rules

- Follow CLAUDE.md's closed-loop workflow strictly — gate block before every Edit/Write
- One task at a time — don't batch multiple tasks
- Run tests after each task, not just at the end
- If a test fails, fix before moving to the next task
- Schema changes require Alembic migration (per CLAUDE.md Schema Evolution Rules)
- New routers must be registered in `main.py` and added to `test-map.json`
- Ask user before proceeding to next task if the current one had complications
- Use subagents for independent tasks when possible (per `superpowers:subagent-driven-development`)

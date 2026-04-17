---
name: env-sync
description: Sync code to server 71, rebuild Docker services, check status. Use when user says "env sync", "sync", "deploy", "push and rebuild", "status", or "/env-sync".
---

# Environment Sync

Orchestrate code sync and Docker service rebuild on server 71 (192.168.68.71).

```
+---------------------------------------------------------------------+
|                     GitLab xpaas (Remote)                            |
|                                                                     |
|   gitlab.xpaas.lenovo.com/enterprisearchitectureteam/northstar      |
|   branch: dev                                                       |
+--------+-----------------------------------------------------------+
         | git push/pull (gitlab remote)
         |
+--------+-----------+    +-------------------------------------------+
| Coding Machine     |    | Server 71 (192.168.68.71)                 |
| (current device)   |    |                                           |
|                    |    | Docker Compose:                           |
| Code editing       |--->|   northstar-frontend   :3003              |
| git operations     |    |   northstar-backend    :8001              |
| ssh to 71          |    |   northstar-postgres   :5434              |
|                    |    |   northstar-neo4j      :7687              |
+--------------------+    |   northstar-converter  (internal)         |
                          |                                           |
Device detection (by IP)  | Also runs host-side scripts:              |
determines execution mode:|   sync_from_egm.py (VPN required)        |
  "local"  = Docker here  |   scan_confluence.py                      |
  "remote" = Docker on 71 |   load_neo4j_from_pg.py                   |
                          +-------------------------------------------+
```

## Config

Device registry and service config: `scripts/envs/devices.json`

## Skills are tracked

`.claude/skills/` is committed to gitlab dev (see `.gitignore`). Skill changes
flow through env-sync push like any code change — commit, push to gitlab,
no docker rebuild needed. The other coding device gets the latest skills
via `env-sync pull`.

## Execution Model

On invocation, **immediately** (in the same message, before any user interaction):

1. Output the gate block
2. Run ALL read-only commands in parallel
3. Display collected state + action plan
4. Ask ONE confirmation for the write actions

### No-Argument Auto-Detect

When invoked without `pull`, `push`, or `status` argument, run Phase 1 first, then auto-detect:
- Local behind gitlab/dev → behave as `pull`
- Local ahead of gitlab/dev → behave as `push`
- All in sync → behave as `status` (display and offer any remaining actions)

### Gate Block (output FIRST, before any tool calls)

```
┌─ ENV-SYNC {pull|push|auto} ───────────────────┐
│ Collecting: device, code, service state...     │
│ Steps:                                         │
│   1. Detect device (IP match)                  │
│   2. git fetch + status                        │
│   3. Check Docker service health on 71         │
│   4. Check SQL migration state                 │
│   5. Display plan → confirm → execute          │
└────────────────────────────────────────────────┘
```

## Core Rules

1. **Gate block first.** Output the gate block as text, then immediately start collecting state. No user interaction until the plan is displayed.
2. **All reads are automatic.** IP detection, git status, git fetch, Docker ps, migration check — all run without asking.
3. **Only writes need confirmation.** git pull, git push, docker compose build, rsync — ONE confirmation for the full action plan.
4. **Never `docker compose down -v`** — that nukes both databases. Only `up -d --build <service>`.
5. **Never `rsync --delete` into local dir** — only outbound to server 71.
6. **Sequence: push code before rebuild** — ensures 71 has latest code before building images.

---

## Phase 1: Collect State (runs immediately after gate block, no confirmation)

Run ALL of the following in parallel where possible. No user interaction.

### Device Detection

```bash
ipconfig getifaddr en0 2>/dev/null; ipconfig getifaddr en1 2>/dev/null
```
Read `scripts/envs/devices.json`, match IP. If no match → ask user (this is the ONE exception in Phase 1).

### Code State

Remote: `gitlab` (GitLab xpaas — see `devices.json` → `git.url`)

```bash
git status --short
git fetch gitlab --quiet
git rev-parse --short HEAD
git rev-parse --short gitlab/dev
git rev-list --count HEAD..gitlab/dev    # local behind remote
git rev-list --count gitlab/dev..HEAD    # local ahead of remote
```

### Service Health (on server 71)

```bash
ssh northstar-server 'cd ~/NorthStar && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"'
```

If SSH alias `northstar-server` doesn't work, fall back to `ssh ruodong@192.168.68.71`.

### SQL Migration State

**Code head:** scan `backend/sql/` for highest-numbered migration file.

**Applied on 71:**
```bash
ssh northstar-server 'docker exec northstar-postgres psql -U northstar -d northstar -t -c "SELECT filename FROM northstar.schema_migrations ORDER BY filename DESC LIMIT 1;"'
```

If the query fails (table might not exist), just note "migration tracking unavailable".

---

## Phase 2: Display Plan

After all state is collected, display a single status block:

```
┌─ ENV-SYNC ─────────────────────────────────────────────────┐
│ Device: {name} | Mode: {execution}                         │
│                                                             │
│ Code:                                                       │
│   local       dev @ {hash} {behind/ahead msg}              │
│   gitlab/dev  @ {hash}                                     │
│   uncommitted: {N files or "clean"}                        │
│                                                             │
│ Services on 71:                                             │
│   frontend    {Up/Down} (port 3003)                        │
│   backend     {Up/Down} (port 8001)                        │
│   postgres    {Up/Down} (port 5434)                        │
│   neo4j       {Up/Down} (port 7687)                        │
│   converter   {Up/Down} (internal)                         │
│                                                             │
│ SQL Migration:                                              │
│   code head: {NNN_xxx.sql}                                 │
│   applied:   {NNN_xxx.sql or "unknown"}                    │
│                                                             │
│ Actions ({pull|push|status}):                               │
│   1. {action description}                ← write operation  │
│   2. {action description}                ← write operation  │
│   (no actions needed — all in sync)                         │
│                                                             │
│ Confirm to proceed?                                         │
└─────────────────────────────────────────────────────────────┘
```

Then ask user ONE confirmation to approve the full action plan.

---

## Phase 3: Execute Actions

After user approves the plan, execute each write action sequentially.

### `/env-sync pull` Actions

1. **If uncommitted changes exist** → ask: stash / commit / continue anyway
2. **If local behind gitlab/dev** → `git pull --no-rebase gitlab dev`
3. If merge conflict on pull → stop, show conflicts, instruct manual resolution

### `/env-sync push` Actions

1. **If uncommitted changes exist** → ask: commit now / skip
2. **If local ahead of gitlab/dev** → `git push gitlab dev`
3. **Pull on 71:** `ssh northstar-server 'cd ~/NorthStar && git pull gitlab dev'`
4. **Rebuild changed services:** Detect which services need rebuild based on changed files:
   - `backend/**` changed → `docker compose up -d --build backend`
   - `frontend/**` changed → `docker compose up -d --build frontend`
   - `scripts/converter/**` changed → `docker compose up -d --build converter`
   - `docker-compose.yml` changed → `docker compose up -d --build`
   - `.claude/**`, `scripts/envs/**`, `*.md`, `.gitignore` only → NO rebuild needed (config/skills/docs only)
   - If unsure → ask user which services to rebuild
5. **Verify:** re-check `docker compose ps` after rebuild

### `/env-sync status` — Read + Offer

Phase 1 + Phase 2. Display the status block. Then:
- If any actionable items found → list them and ask "Execute these actions?" in ONE confirmation
- If all aligned → "All environments in sync." (no question needed)

---

## Error Handling

| Situation | Action |
|-----------|--------|
| SSH unreachable | Mark as ERROR in status, continue collecting other state |
| Docker service down | Include in status, suggest `docker compose up -d <service>` |
| git conflict | Stop execution, show conflict files, instruct manual resolution |
| Build failure | Show docker build output, stop. Do NOT rebuild other services |
| Unknown device | Ask user in Phase 1, offer to register in devices.json |

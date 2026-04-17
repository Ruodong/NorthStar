---
name: env-sync
description: Sync code (GitLab) and database state (195) across Home / Office dev environments. Use when user says "env sync", "sync", "deploy", "push and rebuild", "status", or "/env-sync".
---

# Environment Sync

Keep code and database in sync between **two independent dev environments** (Home and Office) using GitLab xpaas as the code source of truth and Lenovo PG 195 as the shared-DB source of truth. S3 is shared at runtime by both environments — no sync needed there.

```
+---------------------------------------------------------------------+
|                GitLab xpaas — enterprise code (branch: dev)         |
|            gitlab.xpaas.lenovo.com/.../northstar                    |
+-----+--------------------------------------------------------+------+
      ^                                                        ^
      | git push / pull                          git push / pull|
      |                                                         |
+-----+-------------------+                       +-------------+------+
| Home: Mac Mini          |                       | Office: MacBook    |
| 192.168.68.59           |                       | IP: __TBD__        |
| code + git + ssh        |                       | code + git         |
+-----+-------------------+                       +-------------+------+
      | SSH (remote exec)                                       | local
      v                                                         v
+-----+---------------------+                       +-----------+-------+
| Server 71 Docker          |                       | Office Mac Docker |
| (192.168.68.71)           |                       | (localhost)       |
|                           |                       |                   |
| postgres+AGE :5434        |                       | postgres+AGE :5434|
| backend  :8001 (host net) |                       | backend  :8001    |
| frontend :3003            |                       | frontend :3003    |
| converter :8090 (loopback)|                       | converter :8090   |
+-----+-----------+---------+                       +-----+--------+----+
      |           |                                       |        |
      |           | attachment reads (via Lenovo VPN)     |        |
      |           v                                       |        v
      |    +------+----------------------------------+----+--------+---+
      |    |  Lenovo S3 (OSS2)                                         |
      |    |  oss2.xcloud.lenovo.com  bucket: lenovo-it                |
      |    |  prefix: pm/northstar/attachments/  (shared by both)      |
      |    +-----------------------------------------------------------+
      |                                                       |
      | DB sync (schema + meaningful data)                    | DB sync
      v                                                       v
+-----+--------------------------------------------+----------+------+
|   Lenovo PG 195 — shared dev DB source                              |
|   10.196.155.195:5432 / dxp_config_nacos / schema: northstar        |
|   Authoritative schema + shared data source between Home and Office |
+---------------------------------------------------------------------+

Daily env-sync rhythm:
  Morning (start):   git pull gitlab/dev   +   DB pull  195 → local
  Evening (end):     git push gitlab/dev   +   DB push  local → 195
  Any time:          env-sync = diff local vs gitlab/195 → propose actions

Device detection (by IP) picks execution mode:
  - "remote" = Home   → Docker runs on 71 via SSH
  - "local"  = Office → Docker runs on this MacBook
Both environments have identical Docker Compose; only the host differs.
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
│ Collecting: device, code, service, DB state... │
│ Steps:                                         │
│   1. Detect device (IP → Home/Office mode)    │
│   2. git fetch gitlab + ahead/behind count    │
│   3. Check Docker health (71 or local)        │
│   4. Check SQL migration head (local) vs 195  │
│   5. Display plan → confirm → execute         │
└────────────────────────────────────────────────┘
```

## Core Rules

1. **Gate block first.** Output the gate block as text, then immediately start collecting state. No user interaction until the plan is displayed.
2. **All reads are automatic.** IP detection, git status, git fetch, Docker ps, migration check, 195 schema-head query — all run without asking.
3. **Only writes need confirmation.** git pull/push, docker compose build, rsync, DB push/pull — ONE confirmation for the full action plan.
4. **Never `docker compose down -v`** — that wipes the `postgres_data` volume, which now holds both relational tables AND the AGE graph (`ns_graph`). Only `up -d --build <service>`.
5. **Never `rsync --delete` in either direction.** The execution host holds local-only files (`.env` with PG password + Confluence token + S3 credentials) that don't exist on coding machine. `--delete` will wipe them and break backend auth. Always additive rsync; explicitly exclude `.env*`.
6. **Sequence: push code before rebuild** — ensures the execution host has latest code before building images.
7. **DB pushes to 195 are schema-first, data second.** Schema changes (new `backend/sql/NNN_*.sql` files) must land on 195 before anyone else pulls, else their next pull + backend restart would auto-apply a migration nobody else has. Data pushes are table-scoped — never a blind whole-DB overwrite of 195.
8. **195 is shared.** Before pushing DB changes up, run a diff vs 195 first — if 195 has rows your local doesn't (because the other device pushed them earlier), pull-and-merge before pushing.
9. **VPN is required for backend runtime**, not just for git/admin. Backend (on host network) reaches `oss2.xcloud.lenovo.com` for attachment I/O and `10.196.155.195` for DB sync. If VPN drops on the execution host, S3 reads start timing out.

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

### Service Health (on execution host)

Execution host = 71 (if `mode=remote`) or `localhost` (if `mode=local`). Use the SSH hop only in remote mode.

```bash
# Remote (Home):
ssh ruodong@192.168.68.71 'cd ~/NorthStar && docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"'
# Local (Office):
docker compose ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
```

Expect 4 containers: `northstar-frontend`, `northstar-backend`, `northstar-postgres`, `northstar-converter`. (There is no `northstar-neo4j` anymore — the graph was migrated to AGE inside postgres on 2026-04-17.)

### SQL Migration Head (local vs 195)

NorthStar uses Alembic for **forward** migrations (`backend/alembic/versions/NNN_*.py` from `002_*` onwards) and a frozen flat-SQL baseline (`backend/sql/001..018`). The `northstar.alembic_version` table is the single source of truth for "which schema head is this DB at".

```bash
# Code head (repo): latest Alembic revision
ls -1 backend/alembic/versions/*.py | sort | tail -1

# Local-DB head (execution host)
cd backend && alembic current
# Remote (Home): ssh ruodong@192.168.68.71 'cd ~/NorthStar/backend && alembic current'

# 195 shared-DB head — DSN override, no .env edits
cd backend && DATABASE_URL="postgresql://a_appconnect:c8bE9S%23@10.196.155.195:5432/dxp_config_nacos" alembic current
```

A fresh DB just running `ensure_sql_migrations()` is auto-stamped to `001_baseline` — that's the floor. Anything higher means Alembic forward migrations were applied.

If the backend startup log shows a flat-SQL migration error, the container is likely restarting — catch it here before declaring the env healthy.

### DB State vs 195

For each "interesting" table (at minimum `confluence_attachment`, `ref_application`, `ref_project`, `manual_app_aliases`), compute a count + content hash on both local and 195 so the plan can say "195 is ahead by N rows" or "local has uncommitted changes vs 195". Use the same pattern we ran earlier:

```sql
SELECT COUNT(*), md5(string_agg(pk || '|' || COALESCE(s3_key,''), '\n' ORDER BY pk))
FROM northstar.<table>;
```

Show the diffs in the plan block; never auto-push without user approval.

---

## Phase 2: Display Plan

After all state is collected, display a single status block:

```
┌─ ENV-SYNC ─────────────────────────────────────────────────┐
│ Device: {name} | Mode: {remote@71 | local}                 │
│                                                             │
│ Code:                                                       │
│   local       dev @ {hash} {behind/ahead msg}              │
│   gitlab/dev  @ {hash}                                     │
│   uncommitted: {N files or "clean"}                        │
│                                                             │
│ Services ({execution host}):                                │
│   frontend    {Up/Down} (port 3003)                        │
│   backend     {Up/Down} (port 8001, host net, S3: on/off)  │
│   postgres    {Up/Down} (port 5434, apache/age PG16)       │
│   converter   {Up/Down} (127.0.0.1:8090)                   │
│                                                             │
│ SQL Migration:                                              │
│   repo head:    {NNN_xxx.sql}                              │
│   local DB:     {NNN_xxx.sql from startup log}             │
│   195 shared:   {inferred head}                            │
│                                                             │
│ DB Diff (local vs 195):                                     │
│   confluence_attachment   local=N  195=N  (same/ahead/behind)│
│   ref_application         local=N  195=N                   │
│   manual_app_aliases      local=N  195=N                   │
│   ...                                                       │
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

All `docker compose` commands below run on the **execution host** — prefix with `ssh ruodong@192.168.68.71 'cd ~/NorthStar && ...'` in remote mode, run directly in local mode.

### `/env-sync pull` Actions (start-of-day)

**Code side:**
1. If uncommitted changes exist → ask: stash / commit / continue anyway
2. If local behind gitlab/dev → `git pull --no-rebase gitlab dev`
3. If merge conflict → stop, show conflicts, instruct manual resolution

**DB side (195 → local DB on execution host):**
4. If local DB schema head < repo head → `cd backend && alembic upgrade head` on the execution host. Forward migrations (`002_*`+) are NOT auto-applied at startup — env-sync gates the rollout. Baseline (`001_baseline`) is auto-stamped by `ensure_sql_migrations()` if absent.
5. For each "shared" table listed in the diff block, if 195 has newer rows (count or hash differs and 195 > local): pull-overwrite. Default tables: `confluence_attachment`, `ref_application`, `ref_project`, `manual_app_aliases`. Use `asyncpg.copy_records_to_table` inside a single transaction (TRUNCATE + bulk INSERT, as demoed in `/tmp/ns_copy_195_to_71.py`).
6. If local has rows that 195 doesn't (local ahead) → STOP and report; the user must decide whether to throw those away or push them up first.

**Docker side:**
7. Rebuild changed services (see push `Rebuild` rules below).

### `/env-sync push` Actions (end-of-day)

**Code side:**
1. If uncommitted changes exist → ask: commit now / skip
2. If local ahead of gitlab/dev → `git push gitlab dev`
3. **Propagate code to execution host:**
   - **Remote (Home):** prefer `ssh ruodong@192.168.68.71 'cd ~/NorthStar && git pull gitlab dev'`. If 71's git credentials aren't cached (HTTP 401), fall back to rsync from the coding machine as relay, **NO `--delete` flag**:
     ```bash
     rsync -avz \
       --exclude='node_modules' --exclude='.next' --exclude='venv' \
       --exclude='.venv' --exclude='.venv-ingest' --exclude='__pycache__' \
       --exclude='.git' --exclude='.gstack' --exclude='.claude' \
       --exclude='data' --exclude='test-results' \
       --exclude='.env' --exclude='.env.local' \
       --exclude='.gstack-screenshots' \
       --exclude='frontend/tsconfig.tsbuildinfo' \
       /path/to/NorthStar/ ruodong@192.168.68.71:/home/ruodong/NorthStar/
     ```
   - **Local (Office):** no-op — the coding machine IS the execution host.

**DB side (local DB → 195):**
4. Schema first via Alembic. If repo head > 195 head:
   ```bash
   cd backend && DATABASE_URL="postgresql://a_appconnect:c8bE9S%23@10.196.155.195:5432/dxp_config_nacos" alembic upgrade head
   ```
   Forward migrations are gated through env-sync — never auto-applied by the backend.
5. For each "shared" table with local-ahead diff, push-overwrite into 195 (only after Step 4). Same `TRUNCATE + copy_records_to_table` pattern as pull, direction reversed. Respect Core Rule #8 — if 195 has a row your local doesn't (other device pushed first), you must merge before overwriting.

**Docker side:**
6. Rebuild changed services. Detect by changed files:
   - `backend/**` → `docker compose up -d --build backend`
   - `frontend/**` → `docker compose build frontend && docker compose up -d frontend`
     - Frontend **must** rebuild, not just restart — `next.config.mjs` bakes `BACKEND_URL` into the build via `rewrites()`. If `BACKEND_URL` changes, update both `docker-compose.yml` `build.args` AND `environment:`.
   - `scripts/converter/**` → `docker compose up -d --build converter`
   - `docker-compose.yml` → `docker compose up -d --build` (all services)
   - new `backend/sql/NNN_*.sql` → backend rebuild auto-runs `ensure_sql_migrations()`
   - `.claude/**`, `scripts/envs/**`, `*.md`, `.gitignore` only → **no rebuild needed** (flows through git only)

**Verify:**
7. `docker compose ps` + `GET http://{execution_host}:8001/health` (expect `{"status":"ok"}`). Quick DB diff vs 195 should now show "aligned".

### `/env-sync status` — Read + Offer

Phase 1 + Phase 2. Display the status block. Then:
- If any actionable items found → list them and ask "Execute these actions?" in ONE confirmation
- If all aligned → "All environments in sync." (no question needed)

---

## Error Handling

| Situation | Action |
|-----------|--------|
| SSH to 71 unreachable | Mark as ERROR in status, continue collecting other state |
| Docker service down | Include in status, suggest `docker compose up -d <service>` |
| git conflict | Stop execution, show conflict files, instruct manual resolution |
| `git pull` on 71 fails (no credentials) | Fall back to rsync path — do NOT prompt user |
| Build failure | Show docker build output, stop. Do NOT rebuild other services |
| Unknown device | Ask user in Phase 1, offer to register in devices.json |
| Backend /health failing after rebuild | Check `docker logs northstar-backend` — most common causes: AGE graph init failure (check `018_enable_age.sql`), or lost VPN (S3 reads time out) |
| SQL migration error in backend log | Migration file is non-idempotent or non-additive — see `CLAUDE.md § Schema Evolution Rules`. Rollback by fixing the file (don't drop data) |

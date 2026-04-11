#!/usr/bin/env bash
# weekly_sync.sh — NorthStar end-to-end sync + Neo4j refresh.
#
# Designed to be run from cron on server 71. Does the full cycle:
#   1. Sync EGM/EAM master data into NorthStar Postgres
#   2. Rebuild Neo4j from the new Postgres state (loader writes
#      applications_history + ingestion_diffs so /whats-new stays fresh)
#   3. (Optional) Refresh fuzzy merge candidates so the /admin/aliases
#      queue picks up any newly-added non-CMDB apps
#
# This script MUST be run from the host, not from inside a container —
# sync_from_egm.py needs VPN access to reach egm-postgres which the docker
# network can't route to.
#
# Cron setup example (crontab -e):
#   # Every Monday at 08:00 local time
#   0 8 * * 1 /home/lenovo/NorthStar/scripts/weekly_sync.sh >> /var/log/northstar-sync.log 2>&1
#
# Exit code: 0 on success, non-zero if any stage fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

VENV="${NORTHSTAR_VENV:-$REPO_ROOT/.venv-ingest}"
PYTHON="$VENV/bin/python"

log() {
    echo "[weekly_sync] $(date -Iseconds) $*"
}

fail() {
    log "FAIL: $*"
    exit 1
}

# Load .env so EGM_PG_*, NEO4J_*, POSTGRES_PASSWORD are available
if [[ -f "$REPO_ROOT/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    . "$REPO_ROOT/.env"
    set +a
else
    log "WARN: .env not found at $REPO_ROOT/.env — relying on inherited env"
fi

if [[ ! -x "$PYTHON" ]]; then
    fail "python venv not found at $VENV. Create with: python3 -m venv .venv-ingest && .venv-ingest/bin/pip install -r scripts/requirements.txt"
fi

log "===== starting weekly sync ====="

# --- Stage 1: EGM/EAM → NorthStar PG ---
log "stage 1/3: sync_from_egm.py"
"$PYTHON" scripts/sync_from_egm.py || fail "sync_from_egm failed"

# --- Stage 2: PG → Neo4j ---
# --wipe is intentional: the loader is idempotent but starting clean guarantees
# orphan nodes from previous runs are cleaned up (e.g., apps that no longer
# appear in any diagram after an EGM master-data cleanup).
log "stage 2/3: load_neo4j_from_pg.py --wipe"
"$PYTHON" scripts/load_neo4j_from_pg.py --wipe || fail "load_neo4j_from_pg failed"

# --- Stage 3: refresh fuzzy merge candidates ---
# Non-fatal: the aliases system is optional, we shouldn't fail the whole weekly
# sync if it misbehaves.
log "stage 3/3: generate_merge_candidates.py"
if ! "$PYTHON" scripts/generate_merge_candidates.py; then
    log "WARN: generate_merge_candidates failed — continuing anyway"
fi

log "===== weekly sync completed successfully ====="

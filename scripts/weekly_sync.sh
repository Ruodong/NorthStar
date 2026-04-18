#!/usr/bin/env bash
# weekly_sync.sh — NorthStar end-to-end sync + graph refresh.
#
# Designed to be run from cron on server 71. Does the full cycle:
#   1. Sync EGM/EAM master data into NorthStar Postgres
#   2. Rebuild the AGE graph (ns_graph) from the new Postgres state. The
#      loader also writes applications_history + ingestion_diffs so
#      /whats-new stays fresh.
#   3. (Optional) Refresh fuzzy merge candidates so the /admin/aliases
#      queue picks up any newly-added non-CMDB apps
#   4. (Optional) Sync EA documents from Confluence EA space
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

# Load .env so EGM_PG_*, POSTGRES_PASSWORD are available
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
log "stage 1/4: sync_from_egm.py"
"$PYTHON" scripts/sync_from_egm.py || fail "sync_from_egm failed"

# --- Stage 2: PG relational → AGE graph (ns_graph) ---
# --wipe is intentional: the loader is idempotent but starting clean guarantees
# orphan nodes from previous runs are cleaned up (e.g., apps that no longer
# appear in any diagram after an EGM master-data cleanup).
log "stage 2/4: load_age_from_pg.py --wipe"
"$PYTHON" scripts/load_age_from_pg.py --wipe || fail "load_age_from_pg failed"

# --- Stage 3: refresh fuzzy merge candidates ---
# Non-fatal: the aliases system is optional, we shouldn't fail the whole weekly
# sync if it misbehaves.
log "stage 3/4: generate_merge_candidates.py"
if ! "$PYTHON" scripts/generate_merge_candidates.py; then
    log "WARN: generate_merge_candidates failed — continuing anyway"
fi

# --- Stage 4: sync EA documents from Confluence EA space ---
log "stage 4/4: sync_ea_documents.py"
if ! "$PYTHON" scripts/sync_ea_documents.py; then
    log "WARN: sync_ea_documents failed — continuing anyway"
fi

log "===== weekly sync completed successfully ====="

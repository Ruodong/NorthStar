#!/usr/bin/env bash
# run-affected-tests.sh — PostToolUse hook for Claude Code.
#
# Claude calls this after every Edit/Write tool use, passing the changed
# file path as the first arg. We look up the file in scripts/test-map.json
# and run only the tests mapped to it.
#
# Why not just run the full test suite every time? Because it would be slow
# (tests hit Docker PG + Neo4j) and noisy. This hook keeps feedback tight:
# change a router → only its tests run → RED/GREEN is obvious.
#
# Because NorthStar's backend runs in Docker on 71 (not the laptop where
# Claude is executing), we SSH to 71 and run pytest there. That's ~1-2s
# overhead per call but gives real test feedback.
#
# Usage (from Claude's PostToolUse hook):
#     scripts/run-affected-tests.sh <changed-file-path>
#
# Override behaviour with env vars:
#     NORTHSTAR_SKIP_REMOTE_TESTS=1  skip SSH, just validate locally
#     NORTHSTAR_REMOTE_HOST=alias    default: northstar-server
#     NORTHSTAR_REMOTE_REPO=~/path   default: ~/NorthStar
#     NORTHSTAR_TEST_VENV=.venv-xxx  default: .venv-tests

set -euo pipefail

CHANGED_FILE="${1:-}"
if [ -z "$CHANGED_FILE" ]; then
  echo "usage: $0 <changed-file-path>"
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

TEST_MAP="scripts/test-map.json"
if [ ! -f "$TEST_MAP" ]; then
  echo "[hook] no test-map.json, skipping"
  exit 0
fi

# Collect test files affected by this change
MAPPED="$(python3 -c "
import json, fnmatch, sys
m = json.load(open('$TEST_MAP'))
changed = '$CHANGED_FILE'
out = set()
for section in ('backend', 'frontend', 'scripts'):
    for src, cfg in m.get(section, {}).items():
        if changed == src or changed.startswith(src.rstrip('/') + '/'):
            out.update(cfg.get('api', []))
for pattern, tests in m.get('wildcards', {}).items():
    if fnmatch.fnmatch(changed, pattern):
        out.update(tests)
print('\n'.join(sorted(out)))
")"

if [ -z "$MAPPED" ]; then
  echo "[hook] no tests mapped for $CHANGED_FILE"
  exit 0
fi

echo "[hook] affected tests for $CHANGED_FILE:"
echo "$MAPPED" | sed 's/^/  /'

# Local-only mode (fast sanity check, no real tests)
if [ "${NORTHSTAR_SKIP_REMOTE_TESTS:-0}" = "1" ]; then
  echo "[hook] NORTHSTAR_SKIP_REMOTE_TESTS=1 — skipping remote pytest"
  case "$CHANGED_FILE" in
    *.py)
      python3 -m py_compile "$CHANGED_FILE" && echo "[hook] py_compile ok"
      ;;
  esac
  exit 0
fi

# Remote mode: SSH to 71 and run pytest inside the project venv
REMOTE_HOST="${NORTHSTAR_REMOTE_HOST:-northstar-server}"
REMOTE_REPO="${NORTHSTAR_REMOTE_REPO:-~/NorthStar}"
TEST_VENV="${NORTHSTAR_TEST_VENV:-.venv-tests}"

TEST_ARGS="$(echo "$MAPPED" | tr '\n' ' ')"

# Run the tests over SSH, capture exit code and output independently so we
# can make failures LOUD. Anything that hits stderr + a non-zero exit gets
# surfaced by Claude Code into the tool-result the agent sees.
TMP_OUT="$(mktemp)"
trap 'rm -f "$TMP_OUT"' EXIT

set +e
ssh -o ConnectTimeout=5 "$REMOTE_HOST" "
  cd $REMOTE_REPO
  if [ ! -x $TEST_VENV/bin/python ]; then
    echo '[hook] test venv not found at $TEST_VENV — skipping'
    exit 99
  fi
  set -a && source .env && set +a
  $TEST_VENV/bin/python -m pytest $TEST_ARGS -x --tb=short 2>&1 | tail -60
" >"$TMP_OUT" 2>&1
RC=$?
set -e

if [ "$RC" = "99" ]; then
  # Venv not present — non-blocking skip.
  cat "$TMP_OUT"
  exit 0
fi

if [ "$RC" != "0" ]; then
  # RED — print to stderr so Claude Code folds it into the tool-result
  # as a visible failure block, then exit non-zero so the gate is enforced.
  {
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "🔴 [CLOSED-LOOP GATE] RED — affected tests failed for $CHANGED_FILE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cat "$TMP_OUT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Fix the failing tests before continuing. If the failure looks"
    echo "like infrastructure (SSH timeout, venv missing), set"
    echo "NORTHSTAR_SKIP_REMOTE_TESTS=1 to bypass for one edit."
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  } >&2
  exit 2
fi

# GREEN — print a short confirmation so the agent sees the gate ran.
echo "✅ [CLOSED-LOOP GATE] GREEN — $TEST_ARGS"
tail -5 "$TMP_OUT"
exit 0

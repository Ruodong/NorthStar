#!/usr/bin/env bash
# check-closed-loop-gate.sh — enforces the CLOSED-LOOP GATE pre-edit rule.
#
# See CLAUDE.md "Closed-Loop Workflow (MANDATORY)" for the rule. The agent
# must output a gate block AND touch /tmp/northstar-closed-loop-gate BEFORE
# any Edit/Write tool call. This script runs AFTER Edit/Write (PostToolUse)
# and warns if the gate marker is missing or stale.
#
# Warnings are non-blocking — they print to stderr so the agent sees them
# in the tool output, but the edit is not reverted. The goal is to remind,
# not to gate-crash.

set -euo pipefail

GATE_FILE="/tmp/northstar-closed-loop-gate"
MAX_AGE_MINUTES=30

if [[ ! -f "$GATE_FILE" ]]; then
    echo "⚠  closed-loop-gate: marker file missing ($GATE_FILE)." >&2
    echo "   Before editing code, output the CLOSED-LOOP GATE block and run:" >&2
    echo "     touch $GATE_FILE" >&2
    exit 0  # non-blocking
fi

# Check staleness — macOS stat syntax first, fall back to GNU
if stat -f %m "$GATE_FILE" >/dev/null 2>&1; then
    MTIME=$(stat -f %m "$GATE_FILE")
else
    MTIME=$(stat -c %Y "$GATE_FILE")
fi
NOW=$(date +%s)
AGE_SECONDS=$((NOW - MTIME))
AGE_MINUTES=$((AGE_SECONDS / 60))

if (( AGE_MINUTES > MAX_AGE_MINUTES )); then
    echo "⚠  closed-loop-gate: marker is stale ($AGE_MINUTES min old, max $MAX_AGE_MINUTES)." >&2
    echo "   Re-output the CLOSED-LOOP GATE block for the current task and" >&2
    echo "   refresh the marker: touch $GATE_FILE" >&2
    exit 0  # non-blocking
fi

exit 0

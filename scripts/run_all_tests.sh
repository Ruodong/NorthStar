#!/bin/bash
# Full regression test suite for NorthStar.
# Runs: backend unit tests → API integration tests → frontend unit tests → Playwright E2E
#
# Usage:
#   ./scripts/run_all_tests.sh              # all suites
#   ./scripts/run_all_tests.sh --no-e2e     # skip Playwright (faster)
#
# Prerequisites:
#   - Backend running on 71 (docker compose up -d)
#   - .venv-tests with pytest, httpx, psycopg, etc.
#   - Frontend node_modules with vitest
#   - Playwright browsers installed (npx playwright install chromium)

set -euo pipefail
cd "$(dirname "$0")/.."

SKIP_E2E=false
for arg in "$@"; do
  [[ "$arg" == "--no-e2e" ]] && SKIP_E2E=true
done

PASS=0
FAIL=0
TOTAL_START=$(date +%s)

run_suite() {
    local name="$1"
    shift
    echo ""
    echo "════════════════════════════════════════════════════════════════"
    echo "  $name"
    echo "════════════════════════════════════════════════════════════════"
    local start=$(date +%s)
    if "$@"; then
        local elapsed=$(( $(date +%s) - start ))
        echo "  ✅ $name — PASSED (${elapsed}s)"
        PASS=$((PASS + 1))
    else
        local elapsed=$(( $(date +%s) - start ))
        echo "  ❌ $name — FAILED (${elapsed}s)"
        FAIL=$((FAIL + 1))
    fi
}

# 1. Backend unit tests (pure functions, no DB needed)
run_suite "Backend Unit Tests" \
    python3 -m pytest api-tests/test_unit_*.py -v --tb=short

# 2. API integration tests (needs backend + PG + Neo4j on 71)
run_suite "API Integration Tests" \
    python3 -m pytest api-tests/ --ignore=api-tests/test_unit_drawio_parser.py \
                                  --ignore=api-tests/test_unit_title_parser.py \
                                  --ignore=api-tests/test_unit_image_vision.py \
                                  --ignore=api-tests/test_unit_confluence_body.py \
                                  --ignore=api-tests/test_unit_name_normalize.py \
                                  -v --tb=short

# 3. Frontend unit tests (Vitest)
if [ -d "frontend/node_modules/.bin" ]; then
    run_suite "Frontend Unit Tests (Vitest)" \
        npx --prefix frontend vitest run
else
    echo "  ⏭ Frontend Unit Tests — SKIPPED (no node_modules)"
fi

# 4. Playwright E2E tests
if [ "$SKIP_E2E" = true ]; then
    echo ""
    echo "  ⏭ Playwright E2E — SKIPPED (--no-e2e flag)"
elif command -v npx &>/dev/null && [ -d "node_modules/@playwright" ]; then
    run_suite "Playwright E2E Tests" \
        npx playwright test --reporter=list
else
    echo ""
    echo "  ⏭ Playwright E2E — SKIPPED (playwright not installed)"
fi

# Summary
TOTAL_ELAPSED=$(( $(date +%s) - TOTAL_START ))
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  REGRESSION SUMMARY"
echo "════════════════════════════════════════════════════════════════"
echo "  Suites passed: $PASS"
echo "  Suites failed: $FAIL"
echo "  Total time:    ${TOTAL_ELAPSED}s"
echo "════════════════════════════════════════════════════════════════"

[ "$FAIL" -eq 0 ] && echo "  ✅ ALL GREEN" || echo "  ❌ FAILURES DETECTED"
exit "$FAIL"

#!/usr/bin/env bash
# devnet:smoke, the chain lane's integration check: starts the devnet (free ports unless VEASHI_FOREIGN_PORT /
# VEASHI_HOME_PORT are set), runs scripts/devnet.smoke.ts through the app's data module (request with the default
# oracles in ETH, relay oracle by oracle, rule 1, relay back, bulb on; then a custom selection in USDC ruled 2, bulb
# off) and stops everything it started, on success, failure, SIGINT or SIGTERM.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
VITEST="$APP/node_modules/.bin/vitest"

# Two runs on one host (two worktrees, a critique server) must not share ports: default to free ones.
export VEASHI_FOREIGN_PORT="${VEASHI_FOREIGN_PORT:-auto}"
export VEASHI_HOME_PORT="${VEASHI_HOME_PORT:-auto}"

CHILD=""
STARTED=0
cleanup() {
  local status=$?
  trap - EXIT TERM INT
  if [[ -n "$CHILD" ]] && kill -0 "$CHILD" 2>/dev/null; then
    kill -TERM "$CHILD" 2>/dev/null || true
    wait "$CHILD" 2>/dev/null || true
  fi
  # Only a devnet this run started: a refused start (another devnet live in this checkout) is left alone.
  if [[ "$STARTED" == 1 ]]; then bash "$HERE/devnet.sh" stop || true; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

# Children run in the background and are waited for, so a signal is handled at once.
# While starting, a signal stops devnet.sh, whose own trap stops what it started.
bash "$HERE/devnet.sh" start &
CHILD=$!
if ! wait "$CHILD"; then
  CHILD=""
  echo "[smoke] the devnet did not start" >&2
  exit 1
fi
CHILD=""
STARTED=1

cd "$APP"
"$VITEST" run --config scripts/vitest.smoke.config.ts &
CHILD=$!
wait "$CHILD"

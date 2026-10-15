#!/usr/bin/env bash
# The e2e suite's server: starts the devnet on free ports (deploy + relayer, via
# devnet.sh), builds the app with the fresh public/devnet.json (test wallet enabled), and serves dist/ with
# `vite preview` on 127.0.0.1:$VEASHI_E2E_WEB_PORT until SIGTERM/SIGINT; then stops the server and runs
# `devnet.sh stop`. Any failure stops everything too.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
bin() { echo "$APP/node_modules/.bin/$1"; }

: "${VEASHI_E2E_WEB_PORT:?set VEASHI_E2E_WEB_PORT to the port the app should be served on}"
export VEASHI_FOREIGN_PORT="${VEASHI_FOREIGN_PORT:-auto}"
export VEASHI_HOME_PORT="${VEASHI_HOME_PORT:-auto}"
export VITE_VEASHI_TEST_WALLET=true # devnet.json carries testWallet: true as well

CHILD=""
STARTED=0
cleanup() {
  local status=$?
  trap - EXIT TERM INT
  if [[ -n "$CHILD" ]] && kill -0 "$CHILD" 2>/dev/null; then
    kill -TERM "$CHILD" 2>/dev/null || true
    wait "$CHILD" 2>/dev/null || true
  fi
  if [[ "$STARTED" == 1 ]]; then bash "$HERE/devnet.sh" stop || true; fi
  echo "[serve-e2e] stopped" >&2
  exit "$status"
}
trap cleanup EXIT
trap 'exit 143' TERM
trap 'exit 130' INT

run() { # runs a child in the background and waits for it, so a signal is handled at once
  "$@" &
  CHILD=$!
  wait "$CHILD"
  CHILD=""
}

# While starting, a signal stops devnet.sh, whose own trap stops what it started.
bash "$HERE/devnet.sh" start &
CHILD=$!
if ! wait "$CHILD"; then
  CHILD=""
  echo "[serve-e2e] the devnet did not start" >&2
  exit 1
fi
CHILD=""
STARTED=1

cd "$APP"
echo "[serve-e2e] building the app" >&2
run "$(bin tsc)" -p tsconfig.json --noEmit
run "$(bin vite)" build
echo "[serve-e2e] serving http://127.0.0.1:$VEASHI_E2E_WEB_PORT" >&2
run "$(bin vite)" preview --host 127.0.0.1 --port "$VEASHI_E2E_WEB_PORT" --strictPort

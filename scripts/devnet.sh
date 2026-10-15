#!/usr/bin/env bash
# The local two-chain devnet.
#   bash scripts/devnet.sh [start]  starts both anvils, deploys and configures everything, starts the relayer,
#                                   writes public/devnet.json and exits 0, leaving the processes running detached
#                                   with their pids in .devnet/. On failure it stops what it started.
#   bash scripts/devnet.sh stop     stops every process whose pid is recorded in .devnet/ (and only those).
#   bash scripts/devnet.sh status   prints the recorded processes and whether they are alive.
# Ports: VEASHI_FOREIGN_PORT / VEASHI_HOME_PORT (defaults 8645/8646, `auto` = free ports).
# Relayer pace: VEASHI_RELAY_STEP_MS between oracle reports (default 1500).
# Only 127.0.0.1 is used and the only accounts are anvil's well-known dev accounts (unlocked by anvil).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
STATE="$APP/.devnet"
PUBLIC_JSON="$APP/public/devnet.json"
# vitest 2's vite-node runs the TypeScript deploy and relayer scripts.
VITE_NODE="$APP/node_modules/vite-node/vite-node.mjs"
export PATH="$HOME/.foundry/bin:$PATH"

FOREIGN_CHAIN_ID=84530001 # keep in sync with scripts/lib/seed.ts
HOME_CHAIN_ID=421610001

log() { echo "[devnet] $*" >&2; }
die() {
  log "error: $*"
  exit 1
}

# --- recorded processes ------------------------------------------------------------------------------------------
# Each process has .devnet/<name>.pid and .devnet/<name>.match (a string its command line must contain), so a pid
# reused by an unrelated process after a reboot is never signalled.

cmdline_of() { { tr '\0' ' ' <"/proc/$1/cmdline"; } 2>/dev/null || true; }

is_recorded_alive() { # name
  local pid match
  pid="$(cat "$STATE/$1.pid" 2>/dev/null || true)"
  match="$(cat "$STATE/$1.match" 2>/dev/null || true)"
  [[ -n "$pid" && -n "$match" ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  [[ "$(cmdline_of "$pid")" == *"$match"* ]]
}

recorded_names() {
  local f
  for f in "$STATE"/*.pid; do
    [[ -e "$f" ]] || continue
    basename "$f" .pid
  done
}

stop_recorded() {
  local name pid i alive=()
  [[ -d "$STATE" ]] || return 0
  for name in $(recorded_names); do
    if is_recorded_alive "$name"; then
      pid="$(cat "$STATE/$name.pid")"
      kill -TERM "$pid" 2>/dev/null || true
      alive+=("$name")
    fi
  done
  for name in "${alive[@]+"${alive[@]}"}"; do
    for i in $(seq 1 50); do
      is_recorded_alive "$name" || break
      sleep 0.1
    done
    if is_recorded_alive "$name"; then
      log "$name did not stop on SIGTERM, sending SIGKILL"
      kill -KILL "$(cat "$STATE/$name.pid")" 2>/dev/null || true
      sleep 0.2
    fi
    log "stopped $name (pid $(cat "$STATE/$name.pid"))"
  done
  for name in $(recorded_names); do rm -f "$STATE/$name.pid" "$STATE/$name.match"; done
  rm -f "$STATE/relayer.ready" "$STATE/devnet.public.tmp"
  # The file describes the chains just stopped: remove it so nothing reads stale ports.
  if [[ -f "$STATE/devnet.json" && -f "$PUBLIC_JSON" ]] && cmp -s "$STATE/devnet.json" "$PUBLIC_JSON"; then
    rm -f "$PUBLIC_JSON"
  fi
}

start_detached() { # name match command...
  local name="$1" match="$2"
  shift 2
  setsid nohup "$@" >"$STATE/$name.log" 2>&1 </dev/null &
  echo "$!" >"$STATE/$name.pid"
  echo "$match" >"$STATE/$name.match"
}

# --- ports -------------------------------------------------------------------------------------------------------

free_port() {
  node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port)+"\n");s.close()})'
}

port_in_use() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

resolve_port() { # value default
  local value="${1:-$2}"
  if [[ "$value" == "auto" ]]; then
    free_port
  elif [[ "$value" =~ ^[0-9]+$ ]] && ((value > 0 && value < 65536)); then
    echo "$value"
  else
    die "invalid port '$value' (a number or 'auto')"
  fi
}

wait_rpc() { # name url
  local i
  for i in $(seq 1 150); do
    if curl -sf -m 1 -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' "$2" 2>/dev/null | grep -q '"result"'; then
      return 0
    fi
    is_recorded_alive "$1" || {
      cat "$STATE/$1.log" >&2 || true
      die "$1 exited before answering on $2"
    }
    sleep 0.2
  done
  die "$1 did not answer on $2 within 30 s"
}

# --- commands ----------------------------------------------------------------------------------------------------

cmd_stop() {
  stop_recorded
  log "stopped"
}

cmd_status() {
  local name
  [[ -d "$STATE" ]] || {
    echo "no devnet state"
    return 0
  }
  for name in $(recorded_names); do
    if is_recorded_alive "$name"; then echo "$name: running (pid $(cat "$STATE/$name.pid"))"; else echo "$name: not running"; fi
  done
}

READY=0
on_start_exit() {
  local status=$?
  if [[ "$READY" != 1 ]]; then
    log "start did not complete (status $status): stopping what it started"
    stop_recorded
  fi
  exit "$status"
}

cmd_start() {
  local name live=() foreign_port home_port foreign_rpc home_rpc
  command -v anvil >/dev/null || die "anvil not found: install Foundry (foundryup), it is expected in \$HOME/.foundry/bin"
  command -v forge >/dev/null || die "forge not found: install Foundry (foundryup), it is expected in \$HOME/.foundry/bin"
  command -v node >/dev/null || die "node not found"
  [[ -f "$VITE_NODE" ]] || die "vite-node not found: run 'yarn install' first"

  if [[ -d "$STATE" ]]; then
    for name in $(recorded_names); do is_recorded_alive "$name" && live+=("$name"); done
    if ((${#live[@]})); then
      die "a devnet from this checkout is already running (${live[*]}): run 'bash scripts/devnet.sh stop' first"
    fi
  fi
  rm -f "$PUBLIC_JSON"
  rm -rf "$STATE"
  mkdir -p "$STATE"

  trap on_start_exit EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT

  foreign_port="$(resolve_port "${VEASHI_FOREIGN_PORT:-}" 8645)"
  home_port="$(resolve_port "${VEASHI_HOME_PORT:-}" 8646)"
  while [[ "$home_port" == "$foreign_port" ]]; do home_port="$(free_port)"; done
  for p in "$foreign_port" "$home_port"; do
    port_in_use "$p" && die "port $p is already in use (set VEASHI_FOREIGN_PORT/VEASHI_HOME_PORT, or 'auto')"
  done
  foreign_rpc="http://127.0.0.1:$foreign_port"
  home_rpc="http://127.0.0.1:$home_port"
  echo "$foreign_port $home_port" >"$STATE/ports"

  log "compiling the devnet contracts (forge, contracts/)"
  (cd "$APP/contracts" && forge build >"$STATE/forge.log" 2>&1) || {
    cat "$STATE/forge.log" >&2
    die "forge build failed"
  }

  log "starting anvil: foreign chain $FOREIGN_CHAIN_ID on $foreign_rpc, home chain $HOME_CHAIN_ID on $home_rpc"
  # The literal `--port <n>` comes last so `pgrep -f "anvil.*--port <n>( |$)"` finds exactly this process.
  start_detached anvil-foreign "anvil --host 127.0.0.1 --chain-id $FOREIGN_CHAIN_ID --port $foreign_port" \
    anvil --host 127.0.0.1 --chain-id "$FOREIGN_CHAIN_ID" --port "$foreign_port"
  start_detached anvil-home "anvil --host 127.0.0.1 --chain-id $HOME_CHAIN_ID --port $home_port" \
    anvil --host 127.0.0.1 --chain-id "$HOME_CHAIN_ID" --port "$home_port"
  wait_rpc anvil-foreign "$foreign_rpc"
  wait_rpc anvil-home "$home_rpc"

  log "deploying"
  (cd "$APP" && VEASHI_FOREIGN_RPC="$foreign_rpc" VEASHI_HOME_RPC="$home_rpc" DEVNET_JSON_OUT="$STATE/devnet.json" \
    node "$VITE_NODE" scripts/deploy.ts) >"$STATE/deploy.log" 2>&1 || {
    cat "$STATE/deploy.log" >&2
    die "deployment failed"
  }
  tail -n 1 "$STATE/deploy.log" >&2

  log "starting the relayer (step ${VEASHI_RELAY_STEP_MS:-1500} ms)"
  (
    cd "$APP"
    export DEVNET_JSON="$STATE/devnet.json" RELAYER_READY_FILE="$STATE/relayer.ready"
    export VEASHI_RELAY_STEP_MS="${VEASHI_RELAY_STEP_MS:-1500}"
    start_detached relayer "scripts/relayer.ts" node "$VITE_NODE" scripts/relayer.ts
  )
  local i
  for i in $(seq 1 300); do
    [[ -f "$STATE/relayer.ready" ]] && break
    is_recorded_alive relayer || {
      cat "$STATE/relayer.log" >&2 || true
      die "the relayer exited"
    }
    sleep 0.2
  done
  [[ -f "$STATE/relayer.ready" ]] || die "the relayer did not start within 60 s"

  # Atomic publish: the file appears only once everything is ready (same filesystem, rename).
  mkdir -p "$(dirname "$PUBLIC_JSON")"
  cp "$STATE/devnet.json" "$STATE/devnet.public.tmp"
  mv -f "$STATE/devnet.public.tmp" "$PUBLIC_JSON"
  READY=1
  log "ready: foreign $foreign_rpc, home $home_rpc, public/devnet.json written; stop with 'bash scripts/devnet.sh stop'"
}

case "${1:-start}" in
  start) cmd_start ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  *)
    echo "usage: $0 [start|stop|status]" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# Start, stop or check the whole CREWNBUILD platform on this machine (macOS, Linux; on
# Windows it runs scripts/dev_start.ps1).
#
# Runs, in the background, after the one-time setup in README.md ("Running locally"):
#
#   professional-api        http://127.0.0.1:8000   (uvicorn --reload)
#   partner-api             http://127.0.0.1:8200   (uvicorn --reload)
#   professional-scheduler  python -m app.jobs.run_scheduler
#   partner-scheduler       python -m app.jobs.run_scheduler
#   professional-web        http://localhost:5173   (Vite)
#   partner-web             http://localhost:5373   (Vite)
#
# Each process writes to .dev/logs/<name>.log; their process ids are kept in .dev/pids so
# "stop" ends exactly those processes and their children. Nothing here reads or prints a
# .env file: each backend reads its own.
#
#   scripts/dev_start.sh            start everything and wait until it answers
#   scripts/dev_start.sh status     what is running
#   scripts/dev_start.sh stop       stop everything this script started
#   scripts/dev_start.sh restart
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Windows (Git Bash, MSYS, Cygwin): hand over to dev_start.ps1. Processes started from
# these shells leave stub processes behind that the shell's own process ids cannot stop
# reliably; the PowerShell script tracks the real Windows processes.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    exec powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$ROOT/scripts/dev_start.ps1")" "${1:-start}"
    ;;
esac

RUN_DIR="$ROOT/.dev"
LOG_DIR="$RUN_DIR/logs"
PID_DIR="$RUN_DIR/pids"
TIMEOUT_SECONDS="${DEV_START_TIMEOUT:-90}"

# name|directory|command|port|health url
PARTS=(
  "professional-api|professional/backend|PYTHON -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000|8000|http://127.0.0.1:8000/api/v1/health/db"
  "partner-api|partner/backend|PYTHON -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8200|8200|http://127.0.0.1:8200/api/v1/health/db"
  "professional-scheduler|professional/backend|PYTHON -m app.jobs.run_scheduler||"
  "partner-scheduler|partner/backend|PYTHON -m app.jobs.run_scheduler||"
  "professional-web|professional/frontend|npm run dev|5173|http://localhost:5173/"
  "partner-web|partner/frontend|npm run dev|5373|http://localhost:5373/"
)

red() { printf '\033[31m%s\033[0m\n' "$*"; }
green() { printf '\033[32m%s\033[0m\n' "$*"; }

# The backend's own interpreter.
python_for() {
  local python="$ROOT/$1/.venv/bin/python"
  if [[ -x "$python" ]]; then echo "$python"; else echo ""; fi
}

is_running() { [[ -n "${1:-}" ]] && kill -0 "$1" 2>/dev/null; }

port_in_use() {
  local port="$1" address
  for address in 127.0.0.1 localhost; do
    if (exec 3<>"/dev/tcp/$address/$port") 2>/dev/null; then return 0; fi
  done
  return 1
}

answers() { curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$1" 2>/dev/null | grep -qE '^[234]'; }

# A process and everything it started: uvicorn's reloader and worker, npm and Vite.
kill_tree() {
  local pid="$1" child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null || true
}

check_setup() {
  local problems=() service
  for service in professional partner; do
    [[ -n "$(python_for "$service/backend")" ]] || problems+=("$service/backend/.venv is missing: README step 3.")
    [[ -f "$ROOT/$service/backend/.env" ]] || problems+=("$service/backend/.env is missing: README step 3.")
    [[ -d "$ROOT/$service/frontend/node_modules" ]] || problems+=("$service/frontend/node_modules is missing: run npm ci there (README step 7).")
  done
  command -v npm >/dev/null || problems+=("npm is not on PATH: install Node.js 20 LTS or later.")
  command -v curl >/dev/null || problems+=("curl is not on PATH.")
  if ((${#problems[@]})); then
    for problem in "${problems[@]}"; do red "  - $problem"; done
    red 'Finish the setup in README.md ("Running locally") first.'
    exit 1
  fi
  # The web apps' public settings: created from the template when missing, never overwritten.
  for service in professional partner; do
    if [[ ! -f "$ROOT/$service/frontend/.env.local" ]]; then
      cp "$ROOT/$service/frontend/.env.example" "$ROOT/$service/frontend/.env.local"
      echo "Created $service/frontend/.env.local from .env.example."
    fi
  done
}

running_count() {
  local count=0 file
  for file in "$PID_DIR"/*.pid; do
    [[ -e "$file" ]] || continue
    if is_running "$(cat "$file")"; then count=$((count + 1)); fi
  done
  echo "$count"
}

stop_all() {
  local file name pid stopped=0
  for file in "$PID_DIR"/*.pid; do
    [[ -e "$file" ]] || continue
    name="$(basename "$file" .pid)"
    pid="$(cat "$file")"
    if is_running "$pid"; then
      kill_tree "$pid"
      printf 'stopped  %-23s pid %s\n' "$name" "$pid"
    else
      printf 'gone     %-23s (already stopped)\n' "$name"
    fi
    rm -f "$file"
    stopped=1
  done
  ((stopped)) || echo "Nothing to stop: no processes recorded in .dev/pids."
}

status() {
  local part name port url pid state answer
  for part in "${PARTS[@]}"; do
    IFS='|' read -r name _ _ port url <<<"$part"
    pid="$(cat "$PID_DIR/$name.pid" 2>/dev/null || true)"
    if is_running "$pid"; then state="running  pid $pid"; else state="stopped"; fi
    answer=""
    if [[ -n "$url" ]]; then if answers "$url"; then answer="answers at $url"; else answer="not answering"; fi; fi
    printf '%-23s %-18s %s\n' "$name" "$state" "$answer"
  done
}

start_all() {
  if [[ "$(running_count)" != "0" ]]; then
    red 'Already running (see "dev_start.sh status"). Run "dev_start.sh stop" or "restart" first.'
    exit 1
  fi
  check_setup
  local part name dir command port url busy=0
  for part in "${PARTS[@]}"; do
    IFS='|' read -r name _ _ port _ <<<"$part"
    if [[ -n "$port" ]] && port_in_use "$port"; then red "  - port $port ($name) is already in use"; busy=1; fi
  done
  if ((busy)); then red "Free those ports first; each app only accepts its fixed port."; exit 1; fi
  mkdir -p "$LOG_DIR" "$PID_DIR"

  for part in "${PARTS[@]}"; do
    IFS='|' read -r name dir command _ _ <<<"$part"
    command="${command/PYTHON/$(python_for "$dir")}"
    (cd "$ROOT/$dir" && nohup $command </dev/null >"$LOG_DIR/$name.log" 2>&1 &
      echo $! >"$PID_DIR/$name.pid")
    printf 'started  %-23s pid %s\n' "$name" "$(cat "$PID_DIR/$name.pid")"
  done

  local failed=() pid deadline ok
  for part in "${PARTS[@]}"; do
    IFS='|' read -r name _ _ _ url <<<"$part"
    pid="$(cat "$PID_DIR/$name.pid")"
    deadline=$((SECONDS + TIMEOUT_SECONDS))
    ok=0
    while ((SECONDS < deadline)); do
      is_running "$pid" || break
      if [[ -z "$url" ]]; then sleep 3; is_running "$pid" && ok=1; break; fi
      if answers "$url"; then ok=1; break; fi
      sleep 1
    done
    if ((ok)); then
      green "$(printf 'ready    %-23s %s' "$name" "${url:-running}")"
    else
      failed+=("$name")
      red "$(printf 'FAILED   %-23s last lines of .dev/logs/%s.log:' "$name" "$name")"
      tail -n 15 "$LOG_DIR/$name.log" 2>/dev/null | sed 's/^/    /' || true
    fi
  done
  if ((${#failed[@]})); then
    red "Not everything started (${failed[*]}). Run 'scripts/dev_start.sh stop', fix the cause, and start again."
    exit 1
  fi
  echo
  echo "Professional: http://localhost:5173    Partner: http://localhost:5373"
  echo "Logs: .dev/logs    Stop: scripts/dev_start.sh stop"
}

case "${1:-start}" in
  start) start_all ;;
  stop) stop_all ;;
  status) status ;;
  restart) stop_all; start_all ;;
  *) echo "Usage: scripts/dev_start.sh [start|stop|status|restart]"; exit 2 ;;
esac

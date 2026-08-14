#!/usr/bin/env bash
#
# dev.sh — install, run and supervise the local dev stack.
#
#   ./dev.sh              install deps, migrate, start everything, show status
#   ./dev.sh install      yarn install in every repo + build shared contracts
#   ./dev.sh contracts    rebuild shared contracts only
#   ./dev.sh migrate      run pending database migrations
#   ./dev.sh start   [svc]
#   ./dev.sh stop    [svc]
#   ./dev.sh restart [svc]
#   ./dev.sh status
#   ./dev.sh logs [svc] [-f]
#
# `svc` is one of: backend, frontend. Omit it to act on all of them.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="$ROOT/.dev"
LOG_DIR="$RUN_DIR/logs"

SERVICES=(backend frontend)

dir_of()  { case "$1" in backend) echo "backend"  ;; frontend) echo "frontend" ;; esac; }
port_of() { case "$1" in backend) echo "3000"     ;; frontend) echo "5173"     ;; esac; }
cmd_of()  { case "$1" in backend) echo "start:dev";; frontend) echo "dev"      ;; esac; }
url_of()  {
  case "$1" in
    backend)  echo "http://localhost:3000/api/v1/tasks" ;;
    frontend) echo "http://localhost:5173"           ;;
  esac
}

# ---------------------------------------------------------------- presentation

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; CYAN=''; RESET=''
fi

info() { printf '%s==>%s %s\n' "$CYAN" "$RESET" "$*"; }
warn() { printf '%s[warn]%s %s\n' "$YELLOW" "$RESET" "$*" >&2; }
die()  { printf '%s[error]%s %s\n' "$RED" "$RESET" "$*" >&2; exit 1; }

# ------------------------------------------------------------------- platform

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
  *)                    IS_WINDOWS=0 ;;
esac

# PIDs of whatever is LISTENING on a port. This is the source of truth for
# "is it up?" — it survives a stale pidfile and catches orphaned children.
pids_on_port() {
  local port="$1"
  if [ "$IS_WINDOWS" -eq 1 ]; then
    # No `-p TCP`: that flag is IPv4-only, and Vite binds localhost as
    # [::1]:5173. Plain `-ano` covers both stacks; UDP rows carry no
    # LISTENING state, so the filter below still excludes them.
    netstat -ano 2>/dev/null |
      awk -v port="$port" '$4 == "LISTENING" {
        n = split($2, a, ":")
        if (a[n] == port) print $5
      }' | sort -u
  elif command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$port" -s TCP:LISTEN 2>/dev/null | sort -u
  elif command -v ss >/dev/null 2>&1; then
    ss -lptnH "sport = :$port" 2>/dev/null |
      grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u
  fi
}

proc_alive() { kill -0 "$1" 2>/dev/null; }

# Git Bash pids are MSYS pids; taskkill needs the native Windows pid.
win_pid_of() { ps -W 2>/dev/null | awk -v p="$1" '$1 == p { print $4 }'; }

# Kill a process *and its children*. `yarn dev` spawns node, so killing only
# the parent would leave the real server holding the port.
kill_tree() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  if [ "$IS_WINDOWS" -eq 1 ]; then
    local winpid
    winpid="$(win_pid_of "$pid")"
    [ -z "$winpid" ] && winpid="$pid"
    taskkill //F //T //PID "$winpid" >/dev/null 2>&1
  else
    pkill -TERM -P "$pid" 2>/dev/null
    kill -TERM "$pid" 2>/dev/null
    sleep 1
    pkill -KILL -P "$pid" 2>/dev/null
    kill -KILL "$pid" 2>/dev/null
  fi
  return 0
}

# ---------------------------------------------------------------------- state

pid_file()     { echo "$RUN_DIR/$1.pid"; }
started_file() { echo "$RUN_DIR/$1.started"; }
log_file()     { echo "$LOG_DIR/$1.log"; }

# Echoes "<status> <pid>": running / stopped.
service_state() {
  local svc="$1" port pids pidfile pid
  port="$(port_of "$svc")"
  pids="$(pids_on_port "$port")"

  if [ -n "$pids" ]; then
    echo "running $(echo "$pids" | head -1)"
    return
  fi

  pidfile="$(pid_file "$svc")"
  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile" 2>/dev/null)"
    # Alive but not listening yet — still booting.
    if [ -n "$pid" ] && proc_alive "$pid"; then
      echo "starting $pid"
      return
    fi
  fi

  echo "stopped -"
}

human_uptime() {
  local svc="$1" start now delta
  start="$(cat "$(started_file "$svc")" 2>/dev/null)"
  [ -n "$start" ] || { echo "-"; return; }
  now="$(date +%s)"
  delta=$(( now - start ))
  [ "$delta" -lt 0 ] && { echo "-"; return; }
  if   [ "$delta" -lt 60 ];   then echo "${delta}s"
  elif [ "$delta" -lt 3600 ]; then echo "$((delta / 60))m $((delta % 60))s"
  else echo "$((delta / 3600))h $(((delta % 3600) / 60))m"
  fi
}

# ------------------------------------------------------------------- commands

# Populates the TARGETS array. Returns 1 on an unknown name — deliberately not
# a subshell, so a bad argument can actually fail the command that asked.
TARGETS=()
resolve_targets() {
  TARGETS=()
  if [ "$#" -eq 0 ]; then
    TARGETS=("${SERVICES[@]}")
    return 0
  fi
  local svc known found
  for svc in "$@"; do
    found=0
    for known in "${SERVICES[@]}"; do
      [ "$svc" = "$known" ] && found=1
    done
    if [ "$found" -ne 1 ]; then
      printf '%s[error]%s unknown service '\''%s'\'' (expected: %s)\n' \
        "$RED" "$RESET" "$svc" "${SERVICES[*]}" >&2
      return 1
    fi
    TARGETS+=("$svc")
  done
}

cmd_install() {
  resolve_targets "$@" || return 1
  local svc dir
  for svc in "${TARGETS[@]}"; do
    dir="$ROOT/$(dir_of "$svc")"
    [ -f "$dir/package.json" ] || die "no package.json in $dir"
    info "yarn install — $svc"
    ( cd "$dir" && yarn install ) || die "yarn install failed for $svc"
  done

  # Must run after yarn install: yarn prunes packages that are not in a
  # package.json, and the contracts build is copied in rather than linked.
  "$ROOT/scripts/sync-contracts.sh" || die "contracts sync failed"
}

cmd_migrate() {
  info "running database migrations"
  ( cd "$ROOT/backend" && yarn migration:run ) || die "migrations failed"
}

wait_for_port() {
  local port="$1" pid="$2" timeout="$3" elapsed=0
  while [ "$elapsed" -lt "$timeout" ]; do
    [ -n "$(pids_on_port "$port")" ] && return 0
    proc_alive "$pid" || return 2   # died before binding
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1                          # timed out, still alive
}

start_one() {
  local svc="$1" dir port log pid state
  state="$(service_state "$svc")"
  if [ "${state%% *}" != "stopped" ]; then
    info "$svc already ${state%% *} (pid ${state##* })"
    return 0
  fi

  dir="$ROOT/$(dir_of "$svc")"
  port="$(port_of "$svc")"
  log="$(log_file "$svc")"

  [ -d "$dir/node_modules" ] || warn "$svc has no node_modules — run './dev.sh install' first"

  info "starting $svc (yarn $(cmd_of "$svc")) on port $port"
  : > "$log"
  ( cd "$dir" && exec nohup yarn "$(cmd_of "$svc")" >>"$log" 2>&1 ) &
  pid=$!

  echo "$pid"        > "$(pid_file "$svc")"
  date +%s           > "$(started_file "$svc")"

  wait_for_port "$port" "$pid" 90
  case $? in
    0) printf '    %sready%s  %s\n' "$GREEN" "$RESET" "$(url_of "$svc")" ;;
    2)
      printf '    %sfailed%s — process exited. Last lines of %s:\n' "$RED" "$RESET" "$log"
      tail -n 20 "$log" | sed 's/^/      /'
      rm -f "$(pid_file "$svc")" "$(started_file "$svc")"
      return 1
      ;;
    *)
      warn "$svc did not bind port $port within 90s (still running — check './dev.sh logs $svc')"
      ;;
  esac
}

cmd_start() {
  resolve_targets "$@" || return 1
  local svc rc=0
  for svc in "${TARGETS[@]}"; do
    start_one "$svc" || rc=1
  done
  return $rc
}

stop_one() {
  local svc="$1" port pids pidfile pid stopped=0
  port="$(port_of "$svc")"
  pidfile="$(pid_file "$svc")"

  if [ -f "$pidfile" ]; then
    pid="$(cat "$pidfile" 2>/dev/null)"
    if [ -n "$pid" ] && proc_alive "$pid"; then
      kill_tree "$pid"
      stopped=1
    fi
  fi

  # Anything still holding the port (orphaned child, or a server we did not
  # start) goes too — otherwise the next `start` silently no-ops.
  pids="$(pids_on_port "$port")"
  for pid in $pids; do
    if [ "$IS_WINDOWS" -eq 1 ]; then
      taskkill //F //T //PID "$pid" >/dev/null 2>&1
    else
      kill -TERM "$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null
    fi
    stopped=1
  done

  rm -f "$pidfile" "$(started_file "$svc")"

  if [ "$stopped" -eq 1 ]; then
    info "stopped $svc"
  else
    info "$svc was not running"
  fi
}

cmd_stop() {
  resolve_targets "$@" || return 1
  local svc
  for svc in "${TARGETS[@]}"; do
    stop_one "$svc"
  done
}

cmd_restart() {
  resolve_targets "$@" || return 1
  local svc
  for svc in "${TARGETS[@]}"; do
    stop_one "$svc"
  done
  sleep 1
  cmd_start "$@"
}

cmd_status() {
  local fmt='%-10s %-10s %-8s %-6s %-38s %s\n'
  printf "$BOLD$fmt$RESET" "SERVICE" "STATUS" "PID" "PORT" "URL" "UPTIME"

  local svc state status pid colour uptime
  for svc in "${SERVICES[@]}"; do
    state="$(service_state "$svc")"
    status="${state%% *}"
    pid="${state##* }"

    case "$status" in
      running)  colour="$GREEN"  ;;
      starting) colour="$YELLOW" ;;
      *)        colour="$DIM"    ;;
    esac

    uptime="-"
    [ "$status" != "stopped" ] && uptime="$(human_uptime "$svc")"

    printf '%-10s ' "$svc"
    printf '%s%-10s%s ' "$colour" "$status" "$RESET"
    printf '%-8s %-6s %-38s %s\n' \
      "$pid" "$(port_of "$svc")" "$(url_of "$svc")" "$uptime"
  done

  printf '\n%slogs: %s%s\n' "$DIM" "$LOG_DIR" "$RESET"
}

cmd_logs() {
  local follow=0 targets=()
  local arg
  for arg in "$@"; do
    case "$arg" in
      -f|--follow) follow=1 ;;
      *)           targets+=("$arg") ;;
    esac
  done

  resolve_targets "${targets[@]+"${targets[@]}"}" || return 1

  local svc files=()
  for svc in "${TARGETS[@]}"; do
    files+=("$(log_file "$svc")")
  done

  local f
  for f in "${files[@]}"; do
    [ -f "$f" ] || : > "$f"
  done

  if [ "$follow" -eq 1 ]; then
    tail -n 40 -f "${files[@]}"
  else
    tail -n 40 "${files[@]}"
  fi
}

usage() {
  # Print the header comment block, minus the shebang, stopping at the first
  # non-comment line so this stays correct as the file grows.
  awk 'NR > 2 { if (/^#/) { sub(/^# ?/, ""); print } else { exit } }' \
    "${BASH_SOURCE[0]}"
}

# ----------------------------------------------------------------------- main

command -v yarn >/dev/null 2>&1 || die "yarn is not on PATH"
mkdir -p "$LOG_DIR"

action="${1:-up}"
[ "$#" -gt 0 ] && shift

case "$action" in
  install|i)    cmd_install "$@" ;;
  migrate)      cmd_migrate      ;;
  contracts)    "$ROOT/scripts/sync-contracts.sh" ;;
  start)        cmd_start   "$@" ;;
  stop)         cmd_stop    "$@" ;;
  restart)      cmd_restart "$@" ;;
  status|ps)    cmd_status       ;;
  logs|log)     cmd_logs    "$@" ;;
  up)
    cmd_install || exit 1
    echo
    cmd_migrate || exit 1
    echo
    cmd_start; rc=$?
    echo
    cmd_status
    exit $rc
    ;;
  -h|--help|help) usage ;;
  *) die "unknown command '$action' — try './dev.sh --help'" ;;
esac

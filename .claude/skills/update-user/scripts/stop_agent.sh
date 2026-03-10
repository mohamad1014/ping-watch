#!/usr/bin/env bash
set -euo pipefail

PID_FILE="${1:-/tmp/telegram-update-user.agent.pid}"

if [[ ! -f "$PID_FILE" ]]; then
  echo "no pid file at $PID_FILE"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "stopped pid=$PID"
else
  echo "no running process for pid=$PID"
fi

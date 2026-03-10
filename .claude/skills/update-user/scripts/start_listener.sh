#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/assets/.env}"
OUT_FILE="${2:-/tmp/telegram-update-user.inbox}"
LOG_FILE="${3:-/tmp/telegram-update-user.log}"
PID_FILE="${4:-/tmp/telegram-update-user.pid}"

nohup python3 "$ROOT_DIR/scripts/listen_messages.py" \
  --follow \
  --ack \
  --env "$ENV_FILE" \
  --output-file "$OUT_FILE" \
  --no-stdout \
  >> "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"

echo "started pid=$(cat "$PID_FILE")"

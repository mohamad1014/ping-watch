#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/assets/.env}"
HISTORY_FILE="${2:-$ROOT_DIR/assets/chat_history.jsonl}"
OFFSET_FILE="${3:-$ROOT_DIR/assets/telegram.offset}"
LOG_FILE="${4:-/tmp/telegram-update-user.agent.log}"
PID_FILE="${5:-/tmp/telegram-update-user.agent.pid}"

nohup python3 "$ROOT_DIR/scripts/telegram_agent.py" \
  --env "$ENV_FILE" \
  --history "$HISTORY_FILE" \
  --offset "$OFFSET_FILE" \
  >> "$LOG_FILE" 2>&1 &

echo $! > "$PID_FILE"

echo "started pid=$(cat "$PID_FILE")"

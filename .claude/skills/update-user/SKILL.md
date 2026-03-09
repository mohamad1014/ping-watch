---
name: update-user
description: Send a Telegram message via a bot to notify a user who is away, and optionally listen for their replies to drive next steps. Use when Codex needs to ping the user on Telegram or collect instructions while they are away.
---

# Update User

## Overview

Use the scripts in `scripts/` to send Telegram pings and to listen for replies from the user so Codex can continue work while they are away.

## Files and Uses

- `assets/.env`
  - Stores `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, and optional settings used by the scripts.
  - The scripts load this file by default and allow overrides via CLI flags or environment variables.

- `scripts/send_message.py`
  - Sends a message to the configured chat ID.
  - Supports `--text`, `--text-file`, or stdin for message content.

- `scripts/listen_messages.py`
  - Long-polls Telegram for new messages.
  - Prints replies to stdout so Codex can read the next steps from the terminal.
  - Use `--follow` for continuous listening.
  - Use `--ack` to notify the user their request was received and keep waiting.
  - Use `--output-file` to persist messages for reliable background polling.

- `scripts/telegram_common.py`
  - Shared helpers for loading `.env` and building API URLs.

- `scripts/telegram_agent.py`
  - Full Telegram → Codex loop: records history, checkpoints git, runs Codex, replies with output.

- `scripts/start_agent.sh`
  - Starts the background Telegram → Codex agent.

- `scripts/stop_agent.sh`
  - Stops the background agent.

## Workflow

### 1) Configure the bot

Fill in `assets/.env` with:
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- Optional: `TELEGRAM_PARSE_MODE`, `TELEGRAM_API_BASE`

Do not commit real tokens to version control. Rotate tokens if they were exposed.

### 2) Send a message

Use `scripts/send_message.py` to ping the user:

```bash
python3 scripts/send_message.py --text "Ping: please review the latest changes." --env assets/.env
```

### 3) Listen for replies

Use `scripts/listen_messages.py` to wait for instructions and acknowledge receipt:

```bash
python3 scripts/listen_messages.py --follow --ack --env assets/.env
```

If a reply is received, summarize it and ask how to proceed. The `--ack` flag sends a confirmation message back to the user and continues waiting. If no reply arrives and `--follow` is not set, report that no response was received in the polling window.

### 4) Run the Telegram → Codex agent (recommended)

To keep polling continuously and respond automatically with Codex output, start the agent in the background:

```bash
scripts/start_agent.sh
```

Stop the agent when needed:

```bash
scripts/stop_agent.sh
```

### 5) Chat history + checkpoints

- Chat history is stored at `assets/chat_history.jsonl` (append-only).
- Before each Codex run, the agent creates a git checkpoint commit if there are uncommitted changes.

## Guardrails

- Never log or echo the bot token.
- Confirm with the user before sending sensitive content.

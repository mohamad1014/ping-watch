#!/usr/bin/env python3
"""Read new Telegram messages captured by listen_messages.py."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Read new inbox messages.")
    parser.add_argument("--inbox", default="/tmp/telegram-update-user.inbox")
    parser.add_argument("--state-file", default="/tmp/telegram-update-user.last")
    parser.add_argument("--raw", action="store_true", help="Print raw JSON lines.")
    args = parser.parse_args()

    inbox = Path(args.inbox)
    if not inbox.exists():
        return 0

    last_id = 0
    state = Path(args.state_file)
    try:
        last_id = int(state.read_text(encoding="utf-8").strip() or "0")
    except FileNotFoundError:
        pass
    except ValueError:
        last_id = 0

    newest = last_id
    lines = inbox.read_text(encoding="utf-8").splitlines()
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            record = json.loads(line)
        except json.JSONDecodeError:
            continue
        update_id = int(record.get("update_id") or 0)
        if update_id <= last_id:
            continue
        newest = max(newest, update_id)
        if args.raw:
            print(line)
        else:
            chat_id = record.get("chat_id")
            text = record.get("text") or ""
            print(f"{chat_id}: {text}")

    if newest > last_id:
        state.write_text(str(newest), encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Listen for Telegram messages via bot long-polling."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from telegram_common import build_api_url, default_env_path, load_env_file, merge_env, require


def read_offset(path: Path) -> int:
    try:
        return int(path.read_text(encoding="utf-8").strip() or "0")
    except FileNotFoundError:
        return 0
    except ValueError:
        return 0


def write_offset(path: Path, value: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(str(value), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Listen for Telegram messages.")
    parser.add_argument("--follow", action="store_true", help="Keep listening until interrupted.")
    parser.add_argument("--timeout", type=int, default=30, help="Long-poll timeout seconds.")
    parser.add_argument("--offset-file", default="/tmp/telegram-update-user.offset")
    parser.add_argument("--env", help="Path to .env file (default: assets/.env).")
    parser.add_argument("--chat-id", help="Override TELEGRAM_CHAT_ID.")
    parser.add_argument("--token", help="Override TELEGRAM_BOT_TOKEN.")
    parser.add_argument("--api-base", help="Override TELEGRAM_API_BASE.")
    parser.add_argument("--output-file", help="Append matched messages as JSON lines.")
    parser.add_argument("--no-stdout", action="store_true", help="Do not print to stdout.")
    parser.add_argument(
        "--ack",
        nargs="?",
        const="Request received. Waiting for next steps.",
        help="Send an acknowledgement message after receiving a valid reply. "
        "Provide custom text or omit value to use the default.",
    )
    args = parser.parse_args()

    env_path = Path(args.env) if args.env else default_env_path()
    file_env = load_env_file(env_path)
    env = merge_env(file_env)

    if args.chat_id:
        env["TELEGRAM_CHAT_ID"] = args.chat_id
    if args.token:
        env["TELEGRAM_BOT_TOKEN"] = args.token
    if args.api_base:
        env["TELEGRAM_API_BASE"] = args.api_base

    token = require(env, "TELEGRAM_BOT_TOKEN")
    chat_id = env.get("TELEGRAM_CHAT_ID")
    base = env.get("TELEGRAM_API_BASE", "https://api.telegram.org")

    offset_path = Path(args.offset_file)

    while True:
        try:
            offset = read_offset(offset_path)
            params = {"timeout": args.timeout, "offset": offset + 1}
            url = build_api_url(base, token, "getUpdates")
            url = f"{url}?{urllib.parse.urlencode(params)}"
            with urllib.request.urlopen(url, timeout=args.timeout + 5) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if not data.get("ok"):
                raise RuntimeError(f"Telegram error: {data}")

            results = data.get("result", [])
            if results:
                latest_id = results[-1].get("update_id", offset)
                write_offset(offset_path, latest_id)

            for update in results:
                msg = update.get("message") or update.get("edited_message") or {}
                msg_chat_id = msg.get("chat", {}).get("id")
                text = (msg.get("text") or "").strip()
                if not text:
                    continue

                matched = True
                if chat_id and str(msg_chat_id) != str(chat_id):
                    matched = False

                if not matched:
                    continue

                record = {
                    "update_id": update.get("update_id"),
                    "chat_id": msg_chat_id,
                    "text": text,
                    "date": msg.get("date"),
                }
                if args.output_file:
                    with open(args.output_file, "a", encoding="utf-8") as out:
                        out.write(json.dumps(record, ensure_ascii=True))
                        out.write("\n")

                if not args.no_stdout:
                    if chat_id:
                        print(text)
                    else:
                        print(f"{msg_chat_id}: {text}")
                    sys.stdout.flush()

                if args.ack:
                    send_url = build_api_url(base, token, "sendMessage")
                    payload = {"chat_id": msg_chat_id, "text": args.ack}
                    data = urllib.parse.urlencode(payload).encode("utf-8")
                    req = urllib.request.Request(send_url, data=data, method="POST")
                    with urllib.request.urlopen(req, timeout=20) as resp:
                        result = json.loads(resp.read().decode("utf-8"))
                    if not result.get("ok"):
                        raise RuntimeError(f"Telegram ack error: {result}")

            if not args.follow:
                break
        except Exception as exc:  # noqa: BLE001
            print(f"listen error: {exc}", file=sys.stderr)
            if not args.follow:
                return 2
            time.sleep(5)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

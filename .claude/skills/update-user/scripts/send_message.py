#!/usr/bin/env python3
"""Send a Telegram message via bot."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

from telegram_common import build_api_url, default_env_path, load_env_file, merge_env, require


def read_text(args: argparse.Namespace) -> str:
    if args.text_file:
        return Path(args.text_file).read_text(encoding="utf-8").strip()
    if args.text:
        return args.text.strip()
    if not sys.stdin.isatty():
        return sys.stdin.read().strip()
    return ""


def main() -> int:
    parser = argparse.ArgumentParser(description="Send a Telegram message.")
    parser.add_argument("--text", help="Message text. If omitted, read from stdin.")
    parser.add_argument("--text-file", help="Path to a file containing message text.")
    parser.add_argument("--env", help="Path to .env file (default: assets/.env).")
    parser.add_argument("--chat-id", help="Override TELEGRAM_CHAT_ID.")
    parser.add_argument("--token", help="Override TELEGRAM_BOT_TOKEN.")
    parser.add_argument("--parse-mode", help="Override TELEGRAM_PARSE_MODE.")
    parser.add_argument("--api-base", help="Override TELEGRAM_API_BASE.")
    args = parser.parse_args()

    env_path = Path(args.env) if args.env else default_env_path()
    file_env = load_env_file(env_path)
    env = merge_env(file_env)

    if args.chat_id:
        env["TELEGRAM_CHAT_ID"] = args.chat_id
    if args.token:
        env["TELEGRAM_BOT_TOKEN"] = args.token
    if args.parse_mode:
        env["TELEGRAM_PARSE_MODE"] = args.parse_mode
    if args.api_base:
        env["TELEGRAM_API_BASE"] = args.api_base

    token = require(env, "TELEGRAM_BOT_TOKEN")
    chat_id = require(env, "TELEGRAM_CHAT_ID")
    base = env.get("TELEGRAM_API_BASE", "https://api.telegram.org")
    parse_mode = env.get("TELEGRAM_PARSE_MODE")

    text = read_text(args)
    if not text:
        raise SystemExit("Message text is required (--text, --text-file, or stdin).")

    url = build_api_url(base, token, "sendMessage")
    payload = {"chat_id": chat_id, "text": text}
    if parse_mode:
        payload["parse_mode"] = parse_mode

    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode("utf-8"))

    if not result.get("ok"):
        raise SystemExit(f"Telegram error: {result}")

    message_id = result.get("result", {}).get("message_id")
    if message_id:
        print(f"sent message_id={message_id}")
    else:
        print("sent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Telegram -> Codex agent loop.

Long-polls Telegram for messages from a single chat_id, records history,
creates a checkpoint commit, runs Codex CLI with the message, and replies
with Codex's final output.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from telegram_common import build_api_url, default_env_path, load_env_file, merge_env, require


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def find_git_root(start: Path) -> Path:
    for candidate in [start, *start.parents]:
        if (candidate / ".git").exists():
            return candidate
    return start


def append_history(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=True))
        handle.write("\n")


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


def send_message(base: str, token: str, chat_id: str, text: str) -> None:
    url = build_api_url(base, token, "sendMessage")
    payload = {"chat_id": chat_id, "text": text}
    data = urllib.parse.urlencode(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=20) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if not result.get("ok"):
        raise RuntimeError(f"Telegram error: {result}")


def split_message(text: str, limit: int) -> list[str]:
    if len(text) <= limit:
        return [text]
    parts: list[str] = []
    remaining = text
    while remaining:
        chunk = remaining[:limit]
        parts.append(chunk)
        remaining = remaining[limit:]
    return parts


def git_checkpoint(repo_root: Path, label: str) -> None:
    try:
        inside = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "--is-inside-work-tree"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if inside.returncode != 0 or inside.stdout.strip() != "true":
            return

        status = subprocess.run(
            ["git", "-C", str(repo_root), "status", "--porcelain"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
        if not status.stdout.strip():
            return

        subprocess.run(["git", "-C", str(repo_root), "add", "-A"], check=False)
        subprocess.run(
            ["git", "-C", str(repo_root), "commit", "-m", label],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            check=False,
        )
    except Exception:
        return


def run_codex(prompt: str, repo_root: Path, out_file: Path, log_file: Path) -> str:
    out_file.parent.mkdir(parents=True, exist_ok=True)
    log_file.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        "codex",
        "exec",
        "-C",
        str(repo_root),
        "--skip-git-repo-check",
        "-s",
        "danger-full-access",
        "--color",
        "never",
        "--output-last-message",
        str(out_file),
        "-",
    ]

    with log_file.open("a", encoding="utf-8") as log:
        log.write(f"\n[{utc_now()}] codex exec\n")
        proc = subprocess.run(
            cmd,
            input=prompt,
            text=True,
            stdout=log,
            stderr=log,
            check=False,
        )
        log.write(f"[exit] {proc.returncode}\n")

    if out_file.exists():
        return out_file.read_text(encoding="utf-8").strip()

    return f"Codex finished with exit code {proc.returncode}, but no output was captured."


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Telegram -> Codex agent loop.")
    parser.add_argument("--env", help="Path to .env file (default: assets/.env).")
    parser.add_argument("--history", help="Path to chat history JSONL file.")
    parser.add_argument("--offset", help="Path to offset file.")
    parser.add_argument("--timeout", type=int, default=30, help="Long-poll timeout seconds.")
    parser.add_argument("--sleep", type=int, default=2, help="Sleep between polls on error.")
    parser.add_argument("--ack", default="Request received. Working on it.")
    parser.add_argument("--repo-root", help="Override repo root used by Codex.")
    parser.add_argument("--codex-out", help="File to capture Codex final response.")
    parser.add_argument("--codex-log", help="File to append Codex logs.")
    parser.add_argument("--max-send", type=int, default=3500, help="Max Telegram message length.")
    args = parser.parse_args()

    env_path = Path(args.env) if args.env else default_env_path()
    file_env = load_env_file(env_path)
    env = merge_env(file_env)

    token = require(env, "TELEGRAM_BOT_TOKEN")
    chat_id = require(env, "TELEGRAM_CHAT_ID")
    base = env.get("TELEGRAM_API_BASE", "https://api.telegram.org")

    script_dir = Path(__file__).resolve().parent
    repo_base = Path(args.repo_root) if args.repo_root else Path.cwd()
    repo_root = find_git_root(repo_base)

    history = Path(args.history) if args.history else script_dir.parent / "assets" / "chat_history.jsonl"
    offset_file = Path(args.offset) if args.offset else script_dir.parent / "assets" / "telegram.offset"
    codex_out = Path(args.codex_out) if args.codex_out else Path("/tmp/telegram-update-user.codex.out")
    codex_log = Path(args.codex_log) if args.codex_log else Path("/tmp/telegram-update-user.codex.log")

    while True:
        try:
            offset = read_offset(offset_file)
            params = {"timeout": args.timeout, "offset": offset + 1}
            url = build_api_url(base, token, "getUpdates")
            url = f"{url}?{urllib.parse.urlencode(params)}"
            with urllib.request.urlopen(url, timeout=args.timeout + 5) as resp:
                data = json.loads(resp.read().decode("utf-8"))

            if not data.get("ok"):
                raise RuntimeError(f"Telegram error: {data}")

            results = data.get("result", [])
            if not results:
                continue

            for update in results:
                update_id = int(update.get("update_id") or 0)
                msg = update.get("message") or update.get("edited_message") or {}
                msg_chat_id = msg.get("chat", {}).get("id")
                text = (msg.get("text") or "").strip()
                if not text:
                    write_offset(offset_file, max(offset, update_id))
                    continue

                if str(msg_chat_id) != str(chat_id):
                    write_offset(offset_file, max(offset, update_id))
                    continue

                append_history(
                    history,
                    {
                        "ts": utc_now(),
                        "role": "user",
                        "chat_id": msg_chat_id,
                        "update_id": update_id,
                        "text": text,
                    },
                )

                send_message(base, token, chat_id, args.ack)

                label = f"checkpoint: telegram {update_id} {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"
                git_checkpoint(repo_root, label)

                response = run_codex(text, repo_root, codex_out, codex_log)

                append_history(
                    history,
                    {
                        "ts": utc_now(),
                        "role": "assistant",
                        "chat_id": msg_chat_id,
                        "update_id": update_id,
                        "text": response,
                    },
                )

                for part in split_message(response, args.max_send):
                    send_message(base, token, chat_id, part)

                write_offset(offset_file, max(offset, update_id))

        except Exception:
            time.sleep(args.sleep)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

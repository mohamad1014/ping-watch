#!/usr/bin/env python3
"""Shared helpers for Telegram bot scripts.

Intentionally lightweight; uses only Python stdlib.
"""

from __future__ import annotations

from pathlib import Path
import os


def default_env_path() -> Path:
    return Path(__file__).resolve().parents[1] / "assets" / ".env"


def load_env_file(path: Path) -> dict:
    if not path.exists():
        return {}
    env: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        key = key.strip()
        val = val.strip().strip('"').strip("'")
        env[key] = val
    return env


def merge_env(file_env: dict) -> dict:
    env = dict(file_env)
    for key, val in os.environ.items():
        if key.startswith("TELEGRAM_"):
            env[key] = val
    return env


def build_api_url(base: str, token: str, method: str) -> str:
    base = base.strip().rstrip("/")
    if base.endswith("/bot"):
        return f"{base}{token}/{method}"
    return f"{base}/bot{token}/{method}"


def require(env: dict, key: str) -> str:
    val = env.get(key)
    if not val:
        raise SystemExit(f"Missing required setting: {key}")
    return val

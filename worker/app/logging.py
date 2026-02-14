"""Worker logging configuration."""

from __future__ import annotations

import logging
import os
import sys


def _parse_log_level(value: str | None) -> int:
    if not value:
        return logging.INFO
    parsed = logging.getLevelName(value.strip().upper())
    if isinstance(parsed, int):
        return parsed
    return logging.INFO


def setup_worker_logging() -> int:
    """Configure worker process logging for app/rq visibility."""
    level = _parse_log_level(os.environ.get("WORKER_LOG_LEVEL", "INFO"))

    root = logging.getLogger()
    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s [%(name)s] %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S%z",
            )
        )
        root.addHandler(handler)

    root.setLevel(level)
    logging.getLogger("app").setLevel(level)
    logging.getLogger("rq").setLevel(level)
    logging.getLogger("rq.worker").setLevel(level)
    return level

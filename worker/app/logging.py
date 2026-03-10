"""Worker logging configuration."""

from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import Mapping
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

from rq import get_current_job

LOG_FIELDS = (
    "request_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "queue_name",
    "job_id",
    "device_id",
    "session_id",
    "event_id",
)

_CONTEXT_FIELDS = ContextVar[dict[str, Any]]("worker_log_context", default={})


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
        }
        for field in LOG_FIELDS:
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        return json.dumps(payload)


class WorkerContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        for field, value in _CONTEXT_FIELDS.get().items():
            if getattr(record, field, None) is None and value is not None:
                setattr(record, field, value)

        job = get_current_job()
        if job is None:
            return True

        if getattr(record, "job_id", None) is None:
            setattr(record, "job_id", getattr(job, "id", None))
        if getattr(record, "queue_name", None) is None:
            setattr(record, "queue_name", getattr(job, "origin", None))

        payload = _extract_job_payload(job)
        for field in ("event_id", "session_id", "device_id"):
            value = payload.get(field)
            if getattr(record, field, None) is None and value is not None:
                setattr(record, field, value)

        return True


def _extract_job_payload(job: Any) -> dict[str, Any]:
    for arg in getattr(job, "args", ()):
        if isinstance(arg, Mapping):
            return dict(arg)

    payload = getattr(job, "kwargs", {}).get("payload")
    if isinstance(payload, Mapping):
        return dict(payload)

    return {}


@contextmanager
def worker_log_context(**fields: Any):
    context = dict(_CONTEXT_FIELDS.get())
    context.update({field: value for field, value in fields.items() if value is not None})
    token = _CONTEXT_FIELDS.set(context)
    try:
        yield
    finally:
        _CONTEXT_FIELDS.reset(token)


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
    handler = next(
        (
            existing
            for existing in root.handlers
            if getattr(existing, "_pingwatch_worker_handler", False)
        ),
        None,
    )
    if handler is None:
        handler = logging.StreamHandler(sys.stdout)
        handler._pingwatch_worker_handler = True
        root.addHandler(handler)

    handler.setFormatter(JsonFormatter())

    if not any(
        isinstance(existing, WorkerContextFilter) for existing in handler.filters
    ):
        handler.addFilter(WorkerContextFilter())

    root.setLevel(level)
    logging.getLogger("app").setLevel(level)
    logging.getLogger("rq").setLevel(level)
    logging.getLogger("rq.worker").setLevel(level)
    return level

import io
import json
import logging
import sys

from app import logging as worker_logging
from app.logging import _parse_log_level, setup_worker_logging


def test_parse_log_level_defaults_to_info():
    assert _parse_log_level(None) == logging.INFO
    assert _parse_log_level("") == logging.INFO
    assert _parse_log_level("invalid") == logging.INFO


def test_parse_log_level_accepts_standard_levels():
    assert _parse_log_level("debug") == logging.DEBUG
    assert _parse_log_level("INFO") == logging.INFO
    assert _parse_log_level("warning") == logging.WARNING
    assert _parse_log_level("ERROR") == logging.ERROR


def test_setup_worker_logging_emits_backend_style_json(monkeypatch):
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    stream = io.StringIO()

    monkeypatch.setattr(sys, "stdout", stream)
    root.handlers = []

    try:
        setup_worker_logging()

        logger = logging.getLogger("app.test")
        logger.info("worker log ready")

        output = stream.getvalue().strip()
        assert output.startswith("{")

        payload = json.loads(output)
        assert payload["level"] == "INFO"
        assert payload["message"] == "worker log ready"
        assert "timestamp" in payload
    finally:
        root.handlers = original_handlers
        root.setLevel(original_level)


def test_setup_worker_logging_enriches_records_with_job_and_payload_identifiers(monkeypatch):
    root = logging.getLogger()
    original_handlers = list(root.handlers)
    original_level = root.level
    stream = io.StringIO()

    fake_job = type(
        "FakeJob",
        (),
        {
            "id": "job-123",
            "origin": "clip_uploaded",
            "args": (
                {
                    "event_id": "evt-123",
                    "session_id": "sess-456",
                    "device_id": "dev-789",
                },
            ),
            "kwargs": {},
        },
    )()

    monkeypatch.setattr(sys, "stdout", stream)
    monkeypatch.setattr(worker_logging, "get_current_job", lambda: fake_job, raising=False)
    root.handlers = []

    try:
        setup_worker_logging()

        logger = logging.getLogger("app.test")
        logger.info("processing clip")

        output = stream.getvalue().strip()
        assert output.startswith("{")

        payload = json.loads(output)
        assert payload["queue_name"] == "clip_uploaded"
        assert payload["job_id"] == "job-123"
        assert payload["event_id"] == "evt-123"
        assert payload["session_id"] == "sess-456"
        assert payload["device_id"] == "dev-789"
    finally:
        root.handlers = original_handlers
        root.setLevel(original_level)

import json
import logging
import sys
from datetime import datetime, timezone

LOG_FIELDS = (
    "request_id",
    "method",
    "path",
    "status_code",
    "duration_ms",
    "device_id",
    "session_id",
    "event_id",
)


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


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("pingwatch")
    if logger.handlers:
        return logger

    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    logger.addHandler(handler)
    logger.propagate = False
    return logger

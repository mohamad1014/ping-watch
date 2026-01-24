from typing import Any


def process_clip(payload: dict[str, Any]) -> dict[str, Any]:
    """Placeholder task until inference pipeline is wired."""
    return {"status": "queued", "event_id": payload.get("event_id")}

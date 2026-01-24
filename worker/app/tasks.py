import os
from typing import Any

import httpx


def _api_base_url() -> str:
    return os.environ.get("API_BASE_URL", "http://localhost:8000")


def post_event_summary(
    event_id: str,
    summary: str,
    label: str | None,
    confidence: float | None,
) -> dict[str, Any]:
    payload = {
        "summary": summary,
        "label": label,
        "confidence": confidence,
    }
    response = httpx.post(
        f"{_api_base_url()}/events/{event_id}/summary",
        json=payload,
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def process_clip(payload: dict[str, Any]) -> dict[str, Any]:
    """Placeholder task until inference pipeline is wired."""
    event_id = payload.get("event_id")
    if event_id:
        return post_event_summary(
            event_id=event_id,
            summary="Motion detected",
            label=payload.get("label"),
            confidence=payload.get("confidence"),
        )
    return {"status": "queued", "event_id": event_id}

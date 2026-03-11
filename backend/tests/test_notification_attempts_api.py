from datetime import datetime, timedelta, timezone

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_create_and_list_notification_attempts():
    attempted_at = datetime(2026, 3, 11, 10, 0, tzinfo=timezone.utc)
    finished_at = attempted_at + timedelta(seconds=2)
    next_retry_at = finished_at + timedelta(seconds=30)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev-1"})
        session_id = start.json()["session_id"]
        created = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "dev-1",
                "trigger_type": "motion",
                "duration_seconds": 5.0,
                "clip_uri": "local://clip-1",
                "clip_mime": "video/webm",
                "clip_size_bytes": 128,
            },
        )
        event_id = created.json()["event_id"]

        recorded = await client.post(
            f"/events/{event_id}/notification-attempts",
            json={
                "provider": "telegram",
                "recipient": "chat-123",
                "status": "failed",
                "failure_reason": "telegram status 502",
                "retryable": True,
                "attempt_number": 1,
                "max_attempts": 3,
                "attempted_at": attempted_at.isoformat(),
                "finished_at": finished_at.isoformat(),
                "next_retry_at": next_retry_at.isoformat(),
            },
        )
        listed = await client.get(f"/events/{event_id}/notification-attempts")

    assert recorded.status_code == 200
    recorded_payload = recorded.json()
    assert recorded_payload["event_id"] == event_id
    assert recorded_payload["provider"] == "telegram"
    assert recorded_payload["recipient"] == "chat-123"
    assert recorded_payload["status"] == "failed"
    assert recorded_payload["failure_reason"] == "telegram status 502"
    assert recorded_payload["retryable"] is True
    assert recorded_payload["attempt_number"] == 1
    assert recorded_payload["max_attempts"] == 3
    assert recorded_payload["attempted_at"] == attempted_at.isoformat()
    assert recorded_payload["finished_at"] == finished_at.isoformat()
    assert recorded_payload["next_retry_at"] == next_retry_at.isoformat()

    assert listed.status_code == 200
    assert listed.json() == [recorded_payload]


@pytest.mark.anyio
async def test_notification_attempts_unknown_event_returns_404():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/events/missing/notification-attempts",
            json={
                "provider": "webhook",
                "recipient": "https://example.com/hook",
                "status": "succeeded",
                "failure_reason": None,
                "retryable": False,
                "attempt_number": 1,
                "max_attempts": 1,
                "attempted_at": datetime(2026, 3, 11, 11, 0, tzinfo=timezone.utc).isoformat(),
                "finished_at": datetime(2026, 3, 11, 11, 0, 1, tzinfo=timezone.utc).isoformat(),
                "next_retry_at": None,
            },
        )

    assert response.status_code == 404

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_update_event_failure_marks_failed_with_error_metadata():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        created = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 5.0,
                "clip_uri": "local://clip-fail",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 100,
            },
        )
        event_id = created.json()["event_id"]

        failed = await client.post(
            f"/events/{event_id}/failure",
            json={
                "error_message": "Download failed",
                "error_type": "RuntimeError",
            },
        )

    assert failed.status_code == 200
    payload = failed.json()
    assert payload["status"] == "failed"
    assert payload["summary"] == "Processing failed"
    assert payload["label"] == "error"
    assert payload["confidence"] == 0.0
    assert payload["should_notify"] is False
    assert payload["alert_reason"] == "Download failed"
    assert payload["matched_rules"] == ["error_type:RuntimeError"]


@pytest.mark.anyio
async def test_failed_event_rejects_later_summary_update():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        created = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 5.0,
                "clip_uri": "local://clip-fail",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 100,
            },
        )
        event_id = created.json()["event_id"]

        await client.post(
            f"/events/{event_id}/failure",
            json={"error_message": "Inference timeout", "error_type": "TimeoutError"},
        )
        summary = await client.post(
            f"/events/{event_id}/summary",
            json={"summary": "Recovered summary"},
        )

    assert summary.status_code == 200
    payload = summary.json()
    assert payload["status"] == "failed"
    assert payload["summary"] == "Processing failed"
    assert payload["alert_reason"] == "Inference timeout"
    assert payload["matched_rules"] == ["error_type:TimeoutError"]

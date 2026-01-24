import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_update_event_summary_marks_done():
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
                "duration_seconds": 9.5,
                "clip_uri": "local://clip-1",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 100,
            },
        )
        event_id = created.json()["event_id"]

        updated = await client.post(
            f"/events/{event_id}/summary",
            json={
                "summary": "Motion detected",
                "label": "person",
                "confidence": 0.88,
            },
        )

    assert updated.status_code == 200
    payload = updated.json()
    assert payload["status"] == "done"
    assert payload["summary"] == "Motion detected"
    assert payload["label"] == "person"
    assert payload["confidence"] == 0.88
    assert payload["duration_seconds"] == 9.5


@pytest.mark.anyio
async def test_get_event_summary():
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
                "duration_seconds": 2.0,
                "clip_uri": "local://clip-2",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 200,
            },
        )
        event_id = created.json()["event_id"]

        await client.post(
            f"/events/{event_id}/summary",
            json={
                "summary": "Motion detected",
                "label": "person",
                "confidence": 0.88,
            },
        )

        summary = await client.get(f"/events/{event_id}/summary")

    assert summary.status_code == 200
    payload = summary.json()
    assert payload == {
        "event_id": event_id,
        "summary": "Motion detected",
        "label": "person",
        "confidence": 0.88,
    }


@pytest.mark.anyio
async def test_summary_for_unknown_event_returns_404():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/events/missing/summary")

    assert response.status_code == 404

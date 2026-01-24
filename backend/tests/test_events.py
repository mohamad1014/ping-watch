import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_create_event_records_processing_state():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        response = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "processing"
    assert data["event_id"]


@pytest.mark.anyio
async def test_list_events_returns_created_event():
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
            },
        )
        event_id = created.json()["event_id"]
        response = await client.get(f"/events?session_id={session_id}")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["event_id"] == event_id


@pytest.mark.anyio
async def test_create_event_unknown_session_returns_404():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/events",
            json={
                "session_id": "missing",
                "device_id": "dev_1",
                "trigger_type": "motion",
            },
        )

    assert response.status_code == 404

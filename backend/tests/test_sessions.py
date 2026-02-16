import pytest
from httpx import ASGITransport, AsyncClient
from unittest.mock import patch

from app.main import app


@pytest.mark.anyio
async def test_start_session_creates_session():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/sessions/start", json={"device_id": "dev_1"})

    assert response.status_code == 200
    data = response.json()
    assert data["device_id"] == "dev_1"
    assert data["status"] == "active"
    assert data["session_id"]


@pytest.mark.anyio
async def test_stop_session_sets_status():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        response = await client.post(
            "/sessions/stop", json={"session_id": session_id}
        )

    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "stopped"
    assert data["session_id"] == session_id


@pytest.mark.anyio
async def test_stop_session_unknown_returns_404():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/stop", json={"session_id": "missing"}
        )

    assert response.status_code == 404


@pytest.mark.anyio
async def test_start_session_with_analysis_prompt():
    """Test starting a session with an analysis prompt."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/start",
            json={
                "device_id": "dev_1",
                "analysis_prompt": "Focus on detecting people near the entrance",
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["device_id"] == "dev_1"
    assert data["status"] == "active"
    assert data["analysis_prompt"] == "Focus on detecting people near the entrance"


@pytest.mark.anyio
async def test_start_session_without_analysis_prompt():
    """Test starting a session without an analysis prompt returns null."""
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/sessions/start", json={"device_id": "dev_2"})

    assert response.status_code == 200
    data = response.json()
    assert data["analysis_prompt"] is None


@pytest.mark.anyio
async def test_force_stop_session_drops_processing_events():
    with patch("app.routes.sessions.cancel_session_jobs", return_value=2):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            start = await client.post("/sessions/start", json={"device_id": "dev_1"})
            session_id = start.json()["session_id"]

            create_payload = {
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 8.0,
                "clip_uri": "local://clip",
                "clip_mime": "video/mp4",
                "clip_size_bytes": 2048,
            }
            await client.post("/events", json=create_payload)
            await client.post("/events", json=create_payload)

            response = await client.post(
                "/sessions/force-stop", json={"session_id": session_id}
            )
            events = await client.get(f"/events?session_id={session_id}")

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "stopped"
    assert payload["dropped_processing_events"] == 2
    assert payload["dropped_queued_jobs"] == 2
    assert events.status_code == 200
    assert events.json() == []


@pytest.mark.anyio
async def test_force_stop_session_unknown_returns_404():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/force-stop", json={"session_id": "missing"}
        )

    assert response.status_code == 404

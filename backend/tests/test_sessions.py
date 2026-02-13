import pytest
from httpx import ASGITransport, AsyncClient

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

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.store import reset_store


@pytest.mark.anyio
async def test_start_session_creates_session():
    reset_store()
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
    reset_store()
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
    reset_store()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/stop", json={"session_id": "missing"}
        )

    assert response.status_code == 404

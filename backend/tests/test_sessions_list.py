import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.store import reset_store


@pytest.mark.anyio
async def test_list_sessions_for_device():
    reset_store()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        response = await client.get("/sessions?device_id=dev_1")

    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["session_id"] == session_id
    assert data[0]["status"] == "active"


@pytest.mark.anyio
async def test_list_sessions_empty_for_unknown_device():
    reset_store()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/sessions?device_id=missing")

    assert response.status_code == 200
    assert response.json() == []

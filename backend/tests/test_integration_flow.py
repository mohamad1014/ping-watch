import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.store import reset_store


@pytest.mark.anyio
async def test_session_event_flow():
    reset_store()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        assert start.status_code == 200
        session_id = start.json()["session_id"]

        created = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
            },
        )
        assert created.status_code == 200

        listed = await client.get(f"/events?session_id={session_id}")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        stopped = await client.post(
            "/sessions/stop", json={"session_id": session_id}
        )
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "stopped"

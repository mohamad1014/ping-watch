import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


async def _dev_login(client: AsyncClient, email: str) -> str:
    response = await client.post("/auth/dev/login", json={"email": email})
    assert response.status_code == 200
    return response.json()["access_token"]


@pytest.mark.anyio
async def test_device_registration_isolation_when_auth_required(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner_token = await _dev_login(client, "owner@example.com")
        other_token = await _dev_login(client, "other@example.com")

        first = await client.post(
            "/devices/register",
            json={"device_id": "device-1", "label": "Kitchen"},
            headers={"authorization": f"Bearer {owner_token}"},
        )
        second = await client.post(
            "/devices/register",
            json={"device_id": "device-1", "label": "Kitchen"},
            headers={"authorization": f"Bearer {other_token}"},
        )

    assert first.status_code == 200
    assert second.status_code == 404
    assert second.json() == {"detail": "device not found"}


@pytest.mark.anyio
async def test_session_and_event_cross_user_access_is_blocked(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner_token = await _dev_login(client, "owner@example.com")
        other_token = await _dev_login(client, "other@example.com")

        register = await client.post(
            "/devices/register",
            json={"device_id": "device-1"},
            headers={"authorization": f"Bearer {owner_token}"},
        )
        assert register.status_code == 200

        start = await client.post(
            "/sessions/start",
            json={"device_id": "device-1"},
            headers={"authorization": f"Bearer {owner_token}"},
        )
        assert start.status_code == 200
        session_id = start.json()["session_id"]

        create_event = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "device-1",
                "trigger_type": "motion",
                "duration_seconds": 4.2,
                "clip_uri": "local://clip",
                "clip_mime": "video/webm",
                "clip_size_bytes": 1024,
            },
            headers={"authorization": f"Bearer {owner_token}"},
        )
        assert create_event.status_code == 200

        other_stop = await client.post(
            "/sessions/stop",
            json={"session_id": session_id},
            headers={"authorization": f"Bearer {other_token}"},
        )
        other_create_event = await client.post(
            "/events",
            json={
                "session_id": session_id,
                "device_id": "device-1",
                "trigger_type": "motion",
                "duration_seconds": 4.2,
                "clip_uri": "local://clip-2",
                "clip_mime": "video/webm",
                "clip_size_bytes": 1024,
            },
            headers={"authorization": f"Bearer {other_token}"},
        )
        other_list_events = await client.get(
            f"/events?session_id={session_id}",
            headers={"authorization": f"Bearer {other_token}"},
        )

    assert other_stop.status_code == 404
    assert other_create_event.status_code == 404
    assert other_list_events.status_code == 404
    assert other_list_events.json() == {"detail": "session not found"}


@pytest.mark.anyio
async def test_resource_reads_require_auth_when_enabled(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        sessions = await client.get("/sessions")
        events = await client.get("/events")
        readiness = await client.get(
            "/notifications/telegram/readiness", params={"device_id": "device-1"}
        )

    assert sessions.status_code == 401
    assert sessions.json() == {"detail": "missing bearer token"}
    assert events.status_code == 401
    assert events.json() == {"detail": "missing bearer token"}
    assert readiness.status_code == 401
    assert readiness.json() == {"detail": "missing bearer token"}

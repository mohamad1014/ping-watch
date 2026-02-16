import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_write_endpoints_require_auth_when_enabled(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/sessions/start", json={"device_id": "dev-1"})

    assert response.status_code == 401
    assert response.json() == {"detail": "missing bearer token"}


@pytest.mark.anyio
async def test_invalid_bearer_token_is_rejected(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/sessions/start",
            json={"device_id": "dev-1"},
            headers={"authorization": "Bearer invalid-token"},
        )

    assert response.status_code == 401
    assert response.json() == {"detail": "invalid auth token"}


@pytest.mark.anyio
async def test_dev_login_token_allows_protected_write(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        login = await client.post("/auth/dev/login", json={"email": "owner@example.com"})
        token = login.json()["access_token"]
        register = await client.post(
            "/devices/register",
            json={"device_id": "dev-1"},
            headers={"authorization": f"Bearer {token}"},
        )
        response = await client.post(
            "/sessions/start",
            json={"device_id": "dev-1"},
            headers={"authorization": f"Bearer {token}"},
        )

    assert login.status_code == 200
    assert login.json()["token_type"] == "bearer"
    assert register.status_code == 200
    assert response.status_code == 200
    assert response.json()["status"] == "active"


@pytest.mark.anyio
async def test_dev_login_reuses_existing_user_id(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        first = await client.post(
            "/auth/dev/login",
            json={"user_id": "user-dev-1", "email": "owner@example.com"},
        )
        second = await client.post(
            "/auth/dev/login",
            json={"user_id": "user-dev-1"},
        )

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["user_id"] == "user-dev-1"
    assert second.json()["user_id"] == "user-dev-1"
    assert first.json()["access_token"] != second.json()["access_token"]


@pytest.mark.anyio
async def test_telegram_webhook_stays_public_when_auth_required(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/notifications/telegram/webhook", json=["bad"])

    assert response.status_code == 200
    assert response.json() == {"ok": True}

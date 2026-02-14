import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


class _MockResponse:
    def __init__(self, status_code: int, payload: dict):
        self.status_code = status_code
        self._payload = payload
        self.text = str(payload)

    def json(self):
        return self._payload


@pytest.mark.anyio
async def test_telegram_readiness_returns_not_configured_when_token_missing(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.get("/notifications/telegram/readiness", params={"device_id": "dev-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is False
    assert payload["ready"] is False
    assert payload["status"] == "not_configured"


@pytest.mark.anyio
async def test_telegram_readiness_requires_linked_chat_for_device(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    mock_get = pytest.fail
    monkeypatch.setattr(httpx, "get", mock_get)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.get("/notifications/telegram/readiness", params={"device_id": "dev-1"})

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["ready"] is False
    assert payload["status"] == "needs_user_action"
    assert payload["connect_url"] == "https://t.me/pingwatch_bot?start=dev-1"


@pytest.mark.anyio
async def test_telegram_link_persists_chat_by_device_and_readiness_becomes_ready(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    def mock_get(url: str, *, params: dict[str, str], timeout: float):
        assert timeout > 0
        if url.endswith("/getUpdates"):
            assert params == {"timeout": "0", "limit": "100"}
            return _MockResponse(
                200,
                {
                    "ok": True,
                    "result": [
                        {
                            "update_id": 1,
                            "message": {
                                "text": "/start dev-1",
                                "chat": {"id": 987654321},
                                "from": {"username": "alice"},
                            },
                        }
                    ],
                },
            )
        if url.endswith("/getChat"):
            assert params == {"chat_id": "987654321"}
            return _MockResponse(200, {"ok": True, "result": {"id": 987654321}})
        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(httpx, "get", mock_get)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        link_response = await client.post("/notifications/telegram/link", json={"device_id": "dev-1"})
        readiness_response = await client.get(
            "/notifications/telegram/readiness", params={"device_id": "dev-1"}
        )
        target_response = await client.get(
            "/notifications/telegram/target", params={"device_id": "dev-1"}
        )

    assert link_response.status_code == 200
    link_payload = link_response.json()
    assert link_payload["status"] == "ready"
    assert link_payload["ready"] is True

    readiness_payload = readiness_response.json()
    assert readiness_payload["ready"] is True
    assert readiness_payload["status"] == "ready"

    target_payload = target_response.json()
    assert target_payload == {
        "enabled": True,
        "linked": True,
        "device_id": "dev-1",
        "chat_id": "987654321",
    }

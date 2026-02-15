from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

import app.routes.notifications as notifications_route
from app.db import SessionLocal
from app.main import app
from app.store import get_telegram_link_attempt


@pytest.mark.anyio
async def test_telegram_readiness_returns_not_configured_when_token_missing(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.get(
            "/notifications/telegram/readiness", params={"device_id": "dev-1"}
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is False
    assert payload["ready"] is False
    assert payload["status"] == "not_configured"
    assert "connect_url" not in payload


@pytest.mark.anyio
async def test_telegram_link_start_returns_tokenized_connect_url(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["ready"] is False
    assert payload["status"] == "pending"
    assert payload["attempt_id"]
    assert payload["connect_url"].startswith("https://t.me/pingwatch_bot?")

    parsed = urlparse(payload["connect_url"])
    params = parse_qs(parsed.query)
    token = params.get("start", [""])[0]
    assert token
    assert len(token) >= 20
    assert payload.get("link_code") == token
    assert payload.get("fallback_command") == f"/start {token}"


@pytest.mark.anyio
async def test_telegram_link_start_emits_diagnostic_logs(monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    caplog.set_level("INFO", logger="app.routes.notifications")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )

    assert response.status_code == 200
    assert any(
        "Telegram link start requested for device dev-1" in record.getMessage()
        for record in caplog.records
    )
    assert any(
        "Created Telegram link attempt" in record.getMessage()
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_telegram_link_start_does_not_log_raw_link_token(monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    caplog.set_level("INFO", logger="app.routes.notifications")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )

    assert response.status_code == 200
    payload = response.json()
    token = parse_qs(urlparse(payload["connect_url"]).query)["start"][0]
    assert token
    assert all(token not in record.getMessage() for record in caplog.records)


@pytest.mark.anyio
async def test_telegram_webhook_links_device_and_status_becomes_ready(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    sent_messages: list[dict] = []

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        sent_messages.append({"url": url, "json": json})

        class _Resp:
            status_code = 200
            text = "{}"

            def raise_for_status(self):
                return None

        return _Resp()

    def mock_get(url: str, *, params: dict[str, str], timeout: float):
        assert timeout > 0
        if url.endswith("/getChat"):
            return type(
                "_Resp",
                (),
                {
                    "status_code": 200,
                    "text": "{}",
                    "json": staticmethod(lambda: {"ok": True, "result": {"id": 123456}}),
                },
            )()
        raise AssertionError(f"unexpected url {url}")

    monkeypatch.setattr(httpx, "post", mock_post)
    monkeypatch.setattr(httpx, "get", mock_get)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        start_payload = start_response.json()
        parsed = urlparse(start_payload["connect_url"])
        token = parse_qs(parsed.query)["start"][0]

        webhook_response = await client.post(
            "/notifications/telegram/webhook",
            json={
                "update_id": 1,
                "message": {
                    "text": f"/start {token}",
                    "chat": {"id": 987654321},
                    "from": {"username": "alice"},
                },
            },
        )
        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": start_payload["attempt_id"]},
        )
        readiness_response = await client.get(
            "/notifications/telegram/readiness", params={"device_id": "dev-1"}
        )
        target_response = await client.get(
            "/notifications/telegram/target", params={"device_id": "dev-1"}
        )

    assert webhook_response.status_code == 200
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["ready"] is True
    assert status_payload["status"] == "ready"

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
    assert sent_messages
    assert sent_messages[-1]["url"].endswith("/bottoken/sendMessage")


@pytest.mark.anyio
async def test_telegram_webhook_ignores_non_object_payload(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/notifications/telegram/webhook", json=["bad"])

    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.anyio
async def test_telegram_webhook_ignores_invalid_json_body(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/notifications/telegram/webhook",
            content="{not-json",
            headers={"content-type": "application/json"},
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True}


@pytest.mark.anyio
async def test_telegram_webhook_emits_diagnostic_logs(monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        return type(
            "_Resp",
            (),
            {
                "status_code": 200,
                "text": "{}",
                "raise_for_status": staticmethod(lambda: None),
            },
        )()

    monkeypatch.setattr(httpx, "post", mock_post)
    caplog.set_level("INFO", logger="app.routes.notifications")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        start_payload = start_response.json()
        parsed = urlparse(start_payload["connect_url"])
        token = parse_qs(parsed.query)["start"][0]

        response = await client.post(
            "/notifications/telegram/webhook",
            json={
                "update_id": 7,
                "message": {
                    "text": f"/start {token}",
                    "chat": {"id": 555},
                    "from": {"username": "alice"},
                },
            },
        )

    assert response.status_code == 200
    assert any(
        "Telegram webhook received update_id=7" in record.getMessage()
        for record in caplog.records
    )
    assert any(
        "Telegram webhook parsed command=/start" in record.getMessage()
        for record in caplog.records
    )
    assert any(
        "Linked Telegram chat 555 to device dev-1 via attempt" in record.getMessage()
        for record in caplog.records
    )


@pytest.mark.anyio
async def test_telegram_link_status_returns_pending_for_unconfirmed_attempt(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    def mock_get(url: str, *, params: dict[str, object], timeout: float):
        assert timeout > 0
        assert url.endswith("/getUpdates")
        return type(
            "_Resp",
            (),
            {
                "status_code": 200,
                "text": "{}",
                "json": staticmethod(lambda: {"ok": True, "result": []}),
            },
        )()

    monkeypatch.setattr(httpx, "get", mock_get)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        start_payload = start_response.json()
        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": start_payload["attempt_id"]},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["enabled"] is True
    assert payload["ready"] is False
    assert payload["status"] == "pending"


@pytest.mark.anyio
async def test_telegram_link_status_returns_not_found_for_unknown_attempt(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": "missing-attempt"},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["enabled"] is True
    assert payload["ready"] is False
    assert payload["linked"] is False
    assert payload["status"] == "not_found"


@pytest.mark.anyio
async def test_telegram_link_status_handles_naive_expiry_datetime(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    def mock_get(url: str, *, params: dict[str, object], timeout: float):
        assert timeout > 0
        assert url.endswith("/getUpdates")
        return type(
            "_Resp",
            (),
            {
                "status_code": 200,
                "text": "{}",
                "json": staticmethod(lambda: {"ok": True, "result": []}),
            },
        )()

    monkeypatch.setattr(httpx, "get", mock_get)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        attempt_id = start_response.json()["attempt_id"]

    with SessionLocal() as db:
        attempt = get_telegram_link_attempt(db, attempt_id)
        assert attempt is not None
        attempt.expires_at = attempt.expires_at.replace(tzinfo=None)
        db.commit()

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": attempt_id},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["status"] == "pending"


@pytest.mark.anyio
async def test_telegram_link_status_tolerates_naive_attempt_expiry(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    attempt = type(
        "_Attempt",
        (),
        {
            "attempt_id": "attempt-1",
            "device_id": "dev-1",
            "status": "pending",
            "expires_at": datetime.now(timezone.utc).replace(tzinfo=None)
            + timedelta(minutes=5),
            "chat_id": None,
        },
    )()

    monkeypatch.setattr(
        notifications_route,
        "get_device",
        lambda db, device_id: type("_Device", (), {"device_id": device_id})(),
    )
    monkeypatch.setattr(
        notifications_route,
        "get_telegram_link_attempt",
        lambda db, attempt_id: attempt,
    )
    monkeypatch.setattr(
        notifications_route,
        "_sync_telegram_link_updates",
        lambda db, token: None,
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": "attempt-1"},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["status"] == "pending"


@pytest.mark.anyio
async def test_telegram_link_status_links_attempt_via_get_updates_fallback(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    start_token = ""
    updates_calls: list[dict[str, object]] = []
    post_calls: list[tuple[str, dict]] = []

    class _Resp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.text = "{}"

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "error",
                    request=httpx.Request("POST", "http://test"),
                    response=httpx.Response(self.status_code),
                )

    def mock_get(url: str, *, params: dict[str, object], timeout: float):
        assert timeout > 0
        if url.endswith("/getUpdates"):
            updates_calls.append(params)
            return _Resp(
                200,
                {
                    "ok": True,
                    "result": [
                        {
                            "update_id": 1001,
                            "message": {
                                "text": f"/start {start_token}",
                                "chat": {"id": 778899},
                                "from": {"username": "alice"},
                            },
                        }
                    ],
                },
            )
        raise AssertionError(f"unexpected url {url}")

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        post_calls.append((url, json))
        return _Resp(200, {"ok": True})

    monkeypatch.setattr(httpx, "get", mock_get)
    monkeypatch.setattr(httpx, "post", mock_post)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        start_payload = start_response.json()
        start_token = parse_qs(urlparse(start_payload["connect_url"]).query)["start"][0]

        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": start_payload["attempt_id"]},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["ready"] is True
    assert payload["linked"] is True
    assert payload["status"] == "ready"
    assert updates_calls
    assert any(url.endswith("/bottoken/sendMessage") for url, _ in post_calls)


@pytest.mark.anyio
async def test_telegram_link_status_handles_get_updates_webhook_conflict(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")

    start_token = ""
    get_updates_call_count = 0
    post_calls: list[tuple[str, dict]] = []

    class _Resp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload
            self.text = "{}"

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise httpx.HTTPStatusError(
                    "error",
                    request=httpx.Request("POST", "http://test"),
                    response=httpx.Response(self.status_code),
                )

    def mock_get(url: str, *, params: dict[str, object], timeout: float):
        nonlocal get_updates_call_count
        assert timeout > 0
        if not url.endswith("/getUpdates"):
            raise AssertionError(f"unexpected url {url}")
        get_updates_call_count += 1
        if get_updates_call_count == 1:
            return _Resp(
                409,
                {
                    "ok": False,
                    "description": "Conflict: can't use getUpdates method while webhook is active",
                },
            )
        return _Resp(
            200,
            {
                "ok": True,
                "result": [
                    {
                        "update_id": 1002,
                        "message": {
                            "text": f"/start {start_token}",
                            "chat": {"id": 998877},
                        },
                    }
                ],
            },
        )

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        post_calls.append((url, json))
        if url.endswith("/deleteWebhook"):
            return _Resp(200, {"ok": True, "result": True})
        return _Resp(200, {"ok": True})

    monkeypatch.setattr(httpx, "get", mock_get)
    monkeypatch.setattr(httpx, "post", mock_post)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/devices/register", json={"device_id": "dev-1"})
        start_response = await client.post(
            "/notifications/telegram/link/start", json={"device_id": "dev-1"}
        )
        start_payload = start_response.json()
        start_token = parse_qs(urlparse(start_payload["connect_url"]).query)["start"][0]

        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={"device_id": "dev-1", "attempt_id": start_payload["attempt_id"]},
        )

    assert status_response.status_code == 200
    payload = status_response.json()
    assert payload["ready"] is True
    assert payload["status"] == "ready"
    assert get_updates_call_count == 2
    assert any(url.endswith("/bottoken/deleteWebhook") for url, _ in post_calls)

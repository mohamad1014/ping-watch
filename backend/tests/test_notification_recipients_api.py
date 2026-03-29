import pytest
import httpx
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db import SessionLocal
from app.store import link_device_telegram_chat, register_device


async def _dev_login(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post("/auth/dev/login", json={"email": email})
    assert response.status_code == 200
    return response.json()


def _auth_headers(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_list_recipients_includes_subscription_state(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])
            register_device(db, device_id="dev-2", user_id=owner["user_id"])
            link_device_telegram_chat(
                db,
                device_id="dev-1",
                chat_id="111",
                username="alice",
                user_id=owner["user_id"],
            )
            link_device_telegram_chat(
                db,
                device_id="dev-2",
                chat_id="222",
                username="bob",
                user_id=owner["user_id"],
            )

        response = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["device_id"] == "dev-1"
    assert len(payload["recipients"]) == 2

    recipients_by_chat = {item["chat_id"]: item for item in payload["recipients"]}
    assert recipients_by_chat["111"]["subscribed"] is True
    assert recipients_by_chat["222"]["subscribed"] is False


@pytest.mark.anyio
async def test_add_and_remove_recipient_subscription(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])
            register_device(db, device_id="dev-2", user_id=owner["user_id"])
            link_device_telegram_chat(
                db,
                device_id="dev-1",
                chat_id="111",
                username="alice",
                user_id=owner["user_id"],
            )
            link_device_telegram_chat(
                db,
                device_id="dev-2",
                chat_id="222",
                username="bob",
                user_id=owner["user_id"],
            )

        list_response = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )
        recipient_222 = next(
            item
            for item in list_response.json()["recipients"]
            if item["chat_id"] == "222"
        )
        recipient_111 = next(
            item
            for item in list_response.json()["recipients"]
            if item["chat_id"] == "111"
        )

        add_response = await client.post(
            "/notifications/recipients",
            json={"device_id": "dev-1", "endpoint_id": recipient_222["endpoint_id"]},
            headers=_auth_headers(owner["access_token"]),
        )
        remove_response = await client.request(
            "DELETE",
            "/notifications/recipients",
            params={"device_id": "dev-1", "endpoint_id": recipient_111["endpoint_id"]},
            headers=_auth_headers(owner["access_token"]),
        )
        updated_list_response = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )

    assert add_response.status_code == 200
    assert add_response.json()["subscribed"] is True

    assert remove_response.status_code == 200
    assert remove_response.json() == {
        "device_id": "dev-1",
        "endpoint_id": recipient_111["endpoint_id"],
        "removed": True,
    }

    recipients_by_chat = {
        item["chat_id"]: item for item in updated_list_response.json()["recipients"]
    }
    assert recipients_by_chat["111"]["subscribed"] is False
    assert recipients_by_chat["222"]["subscribed"] is True


@pytest.mark.anyio
async def test_add_recipient_validates_endpoint_exists_and_is_owner_accessible(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")
        other = await _dev_login(client, "other@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])
            register_device(db, device_id="other-dev", user_id=other["user_id"])
            link_device_telegram_chat(
                db,
                device_id="other-dev",
                chat_id="999",
                username="mallory",
                user_id=other["user_id"],
            )

        unknown_response = await client.post(
            "/notifications/recipients",
            json={"device_id": "dev-1", "endpoint_id": "missing-endpoint"},
            headers=_auth_headers(owner["access_token"]),
        )

        other_list = await client.get(
            "/notifications/recipients",
            params={"device_id": "other-dev"},
            headers=_auth_headers(other["access_token"]),
        )
        other_endpoint_id = other_list.json()["recipients"][0]["endpoint_id"]

        forbidden_endpoint_response = await client.post(
            "/notifications/recipients",
            json={"device_id": "dev-1", "endpoint_id": other_endpoint_id},
            headers=_auth_headers(owner["access_token"]),
        )

    assert unknown_response.status_code == 404
    assert unknown_response.json() == {"detail": "notification endpoint not found"}

    assert forbidden_endpoint_response.status_code == 404
    assert forbidden_endpoint_response.json() == {
        "detail": "notification endpoint not found"
    }


@pytest.mark.anyio
async def test_recipient_management_enforces_device_ownership(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")
        other = await _dev_login(client, "other@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])
            link_device_telegram_chat(
                db,
                device_id="dev-1",
                chat_id="111",
                username="alice",
                user_id=owner["user_id"],
            )

        owner_list = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )
        endpoint_id = owner_list.json()["recipients"][0]["endpoint_id"]

        list_response = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(other["access_token"]),
        )
        add_response = await client.post(
            "/notifications/recipients",
            json={"device_id": "dev-1", "endpoint_id": endpoint_id},
            headers=_auth_headers(other["access_token"]),
        )
        remove_response = await client.request(
            "DELETE",
            "/notifications/recipients",
            params={"device_id": "dev-1", "endpoint_id": endpoint_id},
            headers=_auth_headers(other["access_token"]),
        )

    assert list_response.status_code == 404
    assert list_response.json() == {"detail": "device not found"}

    assert add_response.status_code == 404
    assert add_response.json() == {"detail": "device not found"}

    assert remove_response.status_code == 404
    assert remove_response.json() == {"detail": "device not found"}


@pytest.mark.anyio
async def test_owner_can_send_test_telegram_alert_to_subscribed_recipients(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")

    sent_messages: list[dict[str, object]] = []

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        sent_messages.append({"url": url, "json": json})
        return type(
            "_Resp",
            (),
            {
                "status_code": 200,
                "raise_for_status": staticmethod(lambda: None),
            },
        )()

    monkeypatch.setattr(httpx, "post", mock_post)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])
            register_device(db, device_id="dev-2", user_id=owner["user_id"])
            link_device_telegram_chat(
                db,
                device_id="dev-1",
                chat_id="111",
                username="alice",
                user_id=owner["user_id"],
            )
            link_device_telegram_chat(
                db,
                device_id="dev-2",
                chat_id="222",
                username="bob",
                user_id=owner["user_id"],
            )

        recipients_response = await client.get(
            "/notifications/recipients",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )
        bob_endpoint_id = next(
            item["endpoint_id"]
            for item in recipients_response.json()["recipients"]
            if item["chat_id"] == "222"
        )
        await client.post(
            "/notifications/recipients",
            json={"device_id": "dev-1", "endpoint_id": bob_endpoint_id},
            headers=_auth_headers(owner["access_token"]),
        )

        response = await client.post(
            "/notifications/telegram/test",
            json={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "delivered_count": 2}
    assert len(sent_messages) == 2
    assert all(item["url"].endswith("/bottoken/sendMessage") for item in sent_messages)
    assert {item["json"]["chat_id"] for item in sent_messages} == {"111", "222"}

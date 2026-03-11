from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.db import SessionLocal
from app.store import (
    get_device,
    get_notification_invite,
    link_device_telegram_chat,
    register_device,
)


async def _dev_login(client: AsyncClient, email: str) -> dict[str, str]:
    response = await client.post("/auth/dev/login", json={"email": email})
    assert response.status_code == 200
    return response.json()


def _auth_headers(token: str) -> dict[str, str]:
    return {"authorization": f"Bearer {token}"}


@pytest.mark.anyio
async def test_owner_can_create_list_and_revoke_notification_invites(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "true")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="dev-1", user_id=owner["user_id"])

        create_response = await client.post(
            "/notifications/invites",
            json={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )
        created_payload = create_response.json()

        list_response = await client.get(
            "/notifications/invites",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )

        revoke_response = await client.request(
            "DELETE",
            "/notifications/invites",
            params={"device_id": "dev-1", "invite_id": created_payload["invite_id"]},
            headers=_auth_headers(owner["access_token"]),
        )
        revoked_list_response = await client.get(
            "/notifications/invites",
            params={"device_id": "dev-1"},
            headers=_auth_headers(owner["access_token"]),
        )

    assert create_response.status_code == 200
    assert created_payload["device_id"] == "dev-1"
    assert created_payload["status"] == "pending"
    assert created_payload["invite_id"]
    assert created_payload["invite_code"]
    assert created_payload["expires_at"]
    assert created_payload["recipient_chat_id"] is None
    assert created_payload["recipient_telegram_username"] is None

    assert list_response.status_code == 200
    assert list_response.json() == {
        "device_id": "dev-1",
        "invites": [{**created_payload, "invite_code": None}],
    }

    assert revoke_response.status_code == 200
    revoked_payload = revoke_response.json()
    assert revoked_payload["invite_id"] == created_payload["invite_id"]
    assert revoked_payload["status"] == "revoked"
    assert revoked_payload["revoked_at"] is not None

    assert revoked_list_response.status_code == 200
    assert revoked_list_response.json() == {
        "device_id": "dev-1",
        "invites": [{**revoked_payload, "invite_code": None}],
    }


@pytest.mark.anyio
async def test_create_notification_invite_works_without_auth_required(monkeypatch):
    monkeypatch.setenv("AUTH_REQUIRED", "false")

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        with SessionLocal() as db:
            register_device(db, device_id="dev-no-auth")

        create_response = await client.post(
            "/notifications/invites",
            json={"device_id": "dev-no-auth"},
        )
        created_payload = create_response.json()

        with SessionLocal() as db:
            stored_device = get_device(db, "dev-no-auth")
            stored_invite = get_notification_invite(db, created_payload["invite_id"])

    assert create_response.status_code == 200
    assert created_payload["status"] == "pending"
    assert created_payload["invite_code"]
    assert stored_device is not None
    assert stored_device.user_id is not None
    assert stored_invite is not None
    assert stored_invite.owner_user_id == stored_device.user_id


@pytest.mark.anyio
async def test_recipient_can_accept_notification_invite_via_telegram_and_owner_can_revoke_access(
    monkeypatch,
):
    monkeypatch.setenv("AUTH_REQUIRED", "true")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "token")
    monkeypatch.setenv("TELEGRAM_BOT_ONBOARDING_URL", "https://t.me/pingwatch_bot")
    monkeypatch.setenv("WORKER_API_TOKEN", "worker-secret")

    sent_messages: list[dict[str, object]] = []

    class _Resp:
        status_code = 200
        text = "{}"

        @staticmethod
        def json():
            return {"ok": True}

        @staticmethod
        def raise_for_status():
            return None

    def mock_post(url: str, *, json: dict, timeout: float):
        assert timeout > 0
        sent_messages.append({"url": url, "json": json})
        return _Resp()

    monkeypatch.setattr(httpx, "post", mock_post)

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        owner = await _dev_login(client, "owner@example.com")
        recipient = await _dev_login(client, "recipient@example.com")

        with SessionLocal() as db:
            register_device(db, device_id="owner-device", user_id=owner["user_id"])
            register_device(db, device_id="recipient-device", user_id=recipient["user_id"])
            link_device_telegram_chat(
                db,
                device_id="owner-device",
                chat_id="111",
                username="owner",
                user_id=owner["user_id"],
            )

        create_response = await client.post(
            "/notifications/invites",
            json={"device_id": "owner-device"},
            headers=_auth_headers(owner["access_token"]),
        )
        invite_code = create_response.json()["invite_code"]
        invite_id = create_response.json()["invite_id"]

        accept_response = await client.post(
            "/notifications/invites/accept",
            json={"invite_code": invite_code},
            headers=_auth_headers(recipient["access_token"]),
        )
        accept_payload = accept_response.json()
        start_token = parse_qs(urlparse(accept_payload["connect_url"]).query)["start"][0]

        webhook_response = await client.post(
            "/notifications/telegram/webhook",
            json={
                "update_id": 42,
                "message": {
                    "text": f"/start {start_token}",
                    "chat": {"id": 222},
                    "from": {"username": "recipient"},
                },
            },
        )

        status_response = await client.get(
            "/notifications/telegram/link/status",
            params={
                "device_id": "owner-device",
                "attempt_id": accept_payload["attempt_id"],
            },
            headers=_auth_headers(recipient["access_token"]),
        )
        invite_list_response = await client.get(
            "/notifications/invites",
            params={"device_id": "owner-device"},
            headers=_auth_headers(owner["access_token"]),
        )
        recipients_response = await client.get(
            "/notifications/recipients",
            params={"device_id": "owner-device"},
            headers=_auth_headers(owner["access_token"]),
        )
        revoke_response = await client.request(
            "DELETE",
            "/notifications/invites",
            params={"device_id": "owner-device", "invite_id": invite_id},
            headers=_auth_headers(owner["access_token"]),
        )
        revoked_targets_response = await client.get(
            "/notifications/telegram/targets",
            params={"device_id": "owner-device"},
            headers={"authorization": "Bearer worker-secret"},
        )

    assert create_response.status_code == 200

    assert accept_response.status_code == 200
    assert accept_payload["status"] == "pending"
    assert accept_payload["attempt_id"]
    assert accept_payload["connect_url"].startswith("https://t.me/pingwatch_bot?")

    assert webhook_response.status_code == 200

    assert status_response.status_code == 200
    assert status_response.json()["status"] == "ready"
    assert status_response.json()["ready"] is True

    assert invite_list_response.status_code == 200
    invite_payload = invite_list_response.json()
    accepted_invite = invite_payload["invites"][0]
    assert accepted_invite["invite_id"] == invite_id
    assert accepted_invite["status"] == "accepted"
    assert accepted_invite["accepted_at"] is not None
    assert accepted_invite["recipient_chat_id"] == "222"
    assert accepted_invite["recipient_telegram_username"] == "recipient"

    assert recipients_response.status_code == 200
    recipients_by_chat = {
        item["chat_id"]: item for item in recipients_response.json()["recipients"]
    }
    assert recipients_by_chat["222"]["subscribed"] is True

    assert revoke_response.status_code == 200
    assert revoke_response.json()["status"] == "revoked"

    assert revoked_targets_response.status_code == 200
    assert revoked_targets_response.json()["recipients"] == [
        {"chat_id": "111", "telegram_username": "owner"}
    ]
    assert any(item["url"].endswith("/bottoken/sendMessage") for item in sent_messages)

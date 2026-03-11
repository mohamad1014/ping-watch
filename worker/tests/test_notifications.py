"""Tests for outbound notification delivery."""

from unittest.mock import MagicMock

import httpx

from app.notifications import NotificationPayload, send_outbound_notifications


def test_send_outbound_notifications_posts_webhook(monkeypatch):
    monkeypatch.setenv("NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    response = MagicMock()
    response.raise_for_status = MagicMock()
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-1",
        session_id="sess-1",
        summary="Person entered the front door",
        label="person",
        confidence=0.93,
        alert_reason="Matched front-door person rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri="https://blob.example/events/evt-1.webm",
        clip_mime="video/webm",
        clip_data=b"fake-webm",
    )

    result = send_outbound_notifications(payload)

    assert result["webhook_sent"] is True
    assert result["telegram_sent"] is False
    delivery_calls = [
        call for call in mock_post.call_args_list if "notification-attempts" not in call.args[0]
    ]
    assert len(delivery_calls) == 1
    assert delivery_calls[0].args[0] == "https://example.com/hook"
    body = delivery_calls[0].kwargs["json"]
    assert body["event_id"] == "evt-1"
    assert body["summary"] == "Person entered the front door"
    assert body["should_notify"] is True


def test_send_outbound_notifications_posts_telegram_video(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    class TargetsResponse:
        status_code = 200

        def json(self):
            return {
                "enabled": True,
                "linked": True,
                "device_id": "dev-1",
                "recipients": [
                    {"chat_id": "chat-1", "telegram_username": "alice"},
                ],
            }

    mock_get = MagicMock(return_value=TargetsResponse())
    monkeypatch.setattr(httpx, "get", mock_get)

    response = MagicMock()
    response.raise_for_status = MagicMock()
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-2",
        session_id="sess-2",
        device_id="dev-1",
        summary="Dog detected in the driveway",
        label="animal",
        confidence=0.81,
        alert_reason="Matched animal rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm;codecs=vp8,opus",
        clip_data=b"fake-video-bytes",
    )

    result = send_outbound_notifications(payload)

    assert result["telegram_sent"] is True
    assert result["webhook_sent"] is False
    mock_get.assert_called_once_with(
        "http://backend:8000/notifications/telegram/targets",
        params={"device_id": "dev-1"},
        headers=None,
        timeout=10,
    )
    delivery_calls = [
        call for call in mock_post.call_args_list if "notification-attempts" not in call.args[0]
    ]
    assert len(delivery_calls) == 1
    assert delivery_calls[0].args[0] == "https://api.telegram.org/botbot-token/sendVideo"
    files = delivery_calls[0].kwargs["files"]
    assert files["video"][0].startswith("clip-evt-2")
    assert files["video"][2] == "video/webm"


def test_send_outbound_notifications_fans_out_to_all_recipient_chat_ids(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    class TargetsResponse:
        status_code = 200

        def json(self):
            return {
                "enabled": True,
                "linked": True,
                "device_id": "dev-1",
                "recipients": [
                    {"chat_id": "chat-a", "telegram_username": "alice"},
                    {"chat_id": "chat-b", "telegram_username": "bob"},
                ],
            }

    mock_get = MagicMock(return_value=TargetsResponse())
    monkeypatch.setattr(httpx, "get", mock_get)

    response = MagicMock()
    response.raise_for_status = MagicMock()
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-2b",
        session_id="sess-2",
        device_id="dev-1",
        summary="Dog detected in the driveway",
        label="animal",
        confidence=0.81,
        alert_reason="Matched animal rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm;codecs=vp8,opus",
        clip_data=b"fake-video-bytes",
    )

    result = send_outbound_notifications(payload)

    assert result["telegram_sent"] is True
    assert result["webhook_sent"] is False
    mock_get.assert_called_once_with(
        "http://backend:8000/notifications/telegram/targets",
        params={"device_id": "dev-1"},
        headers=None,
        timeout=10,
    )
    delivery_calls = [
        call for call in mock_post.call_args_list if "notification-attempts" not in call.args[0]
    ]
    assert len(delivery_calls) == 2
    chat_ids = [call.kwargs["data"]["chat_id"] for call in delivery_calls]
    assert chat_ids == ["chat-a", "chat-b"]


def test_send_outbound_notifications_forwards_worker_bearer_token_to_target_lookup(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("WORKER_API_TOKEN", "worker-secret")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    class TargetsResponse:
        status_code = 200

        def json(self):
            return {
                "enabled": True,
                "linked": True,
                "device_id": "dev-1",
                "recipients": [
                    {"chat_id": "chat-a", "telegram_username": "alice"},
                ],
            }

    mock_get = MagicMock(return_value=TargetsResponse())
    monkeypatch.setattr(httpx, "get", mock_get)

    response = MagicMock()
    response.raise_for_status = MagicMock()
    monkeypatch.setattr(httpx, "post", MagicMock(return_value=response))

    payload = NotificationPayload(
        event_id="evt-auth",
        session_id="sess-auth",
        device_id="dev-1",
        summary="Dog detected in the driveway",
        label="animal",
        confidence=0.81,
        alert_reason="Matched animal rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake-video-bytes",
    )

    send_outbound_notifications(payload)

    mock_get.assert_called_once_with(
        "http://backend:8000/notifications/telegram/targets",
        params={"device_id": "dev-1"},
        headers={"Authorization": "Bearer worker-secret"},
        timeout=10,
    )


def test_send_outbound_notifications_no_channels(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    mock_post = MagicMock()
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-3",
        session_id="sess-3",
        summary="No destination configured",
        label="motion",
        confidence=0.5,
        alert_reason="Matched rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake",
    )

    result = send_outbound_notifications(payload)

    assert result["telegram_sent"] is False
    assert result["webhook_sent"] is False
    mock_post.assert_not_called()


def test_send_outbound_notifications_logs_when_no_channels(monkeypatch, caplog):
    caplog.set_level("INFO")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    payload = NotificationPayload(
        event_id="evt-log-1",
        session_id="sess-log-1",
        summary="No destination configured",
        label="motion",
        confidence=0.5,
        alert_reason="Matched rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake",
    )

    send_outbound_notifications(payload)

    assert "No outbound notification channels configured for event evt-log-1" in caplog.text


def test_send_outbound_notifications_logs_skip_when_should_notify_false(monkeypatch, caplog):
    caplog.set_level("INFO")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")

    payload = NotificationPayload(
        event_id="evt-log-2",
        session_id="sess-log-2",
        summary="Should not notify",
        label="motion",
        confidence=0.5,
        alert_reason="No alert",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake",
        should_notify=False,
    )

    send_outbound_notifications(payload)

    assert "Skipping outbound notifications for event evt-log-2 because should_notify=false" in caplog.text


def test_send_outbound_notifications_does_not_use_legacy_chat_id_fallback(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "legacy-chat-id")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    class TargetsResponse:
        status_code = 200

        def json(self):
            return {
                "enabled": True,
                "linked": False,
                "device_id": "dev-1",
                "recipients": [],
            }

    mock_get = MagicMock(return_value=TargetsResponse())
    monkeypatch.setattr(httpx, "get", mock_get)
    mock_post = MagicMock()
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-legacy",
        session_id="sess-legacy",
        device_id="dev-1",
        summary="Legacy fallback should not be used",
        label="motion",
        confidence=0.5,
        alert_reason="Matched rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake",
    )

    result = send_outbound_notifications(payload)

    assert result == {"telegram_sent": False, "webhook_sent": False}
    mock_get.assert_called_once_with(
        "http://backend:8000/notifications/telegram/targets",
        params={"device_id": "dev-1"},
        headers=None,
        timeout=10,
    )
    mock_post.assert_not_called()


def test_send_outbound_notifications_retries_webhook_request_errors(monkeypatch):
    monkeypatch.setenv("NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("NOTIFICATION_MAX_RETRIES", "1")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    attempts = {"count": 0}

    def fake_post(url, **kwargs):
        if url == "https://example.com/hook":
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise httpx.ConnectError("network down", request=httpx.Request("POST", url))
            response = MagicMock()
            response.raise_for_status = MagicMock()
            return response

        if url == "http://localhost:8000/events/evt-webhook-retry/notification-attempts":
            response = MagicMock()
            response.raise_for_status = MagicMock()
            return response

        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(httpx, "post", fake_post)

    payload = NotificationPayload(
        event_id="evt-webhook-retry",
        session_id="sess-3",
        summary="Webhook retry",
        label="motion",
        confidence=0.5,
        alert_reason="Matched rule",
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        clip_uri=None,
        clip_mime="video/webm",
        clip_data=b"fake",
    )

    result = send_outbound_notifications(payload)

    assert result["telegram_sent"] is False
    assert result["webhook_sent"] is True
    assert attempts["count"] == 2

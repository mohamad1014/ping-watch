"""Tests for outbound notification delivery."""

from unittest.mock import MagicMock

import httpx

from app.notifications import NotificationPayload, send_outbound_notifications


def test_send_outbound_notifications_posts_webhook(monkeypatch):
    monkeypatch.setenv("NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

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
    mock_post.assert_called_once()
    assert mock_post.call_args.args[0] == "https://example.com/hook"
    body = mock_post.call_args.kwargs["json"]
    assert body["event_id"] == "evt-1"
    assert body["summary"] == "Person entered the front door"
    assert body["should_notify"] is True


def test_send_outbound_notifications_posts_telegram_video(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat-1")
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    response = MagicMock()
    response.raise_for_status = MagicMock()
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    payload = NotificationPayload(
        event_id="evt-2",
        session_id="sess-2",
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
    mock_post.assert_called_once()
    assert mock_post.call_args.args[0] == "https://api.telegram.org/botbot-token/sendVideo"
    files = mock_post.call_args.kwargs["files"]
    assert files["video"][0].startswith("clip-evt-2")
    assert files["video"][2] == "video/webm"


def test_send_outbound_notifications_resolves_chat_id_per_device(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    class TargetResponse:
        status_code = 200

        def json(self):
            return {
                "enabled": True,
                "linked": True,
                "device_id": "dev-1",
                "chat_id": "chat-from-device",
            }

    mock_get = MagicMock(return_value=TargetResponse())
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
        "http://backend:8000/notifications/telegram/target",
        params={"device_id": "dev-1"},
        timeout=10,
    )
    assert mock_post.call_args.kwargs["data"]["chat_id"] == "chat-from-device"


def test_send_outbound_notifications_no_channels(monkeypatch):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
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
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
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
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "chat-1")

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

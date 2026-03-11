from unittest.mock import MagicMock

import httpx

from app.notifications import NotificationPayload, send_outbound_notifications


def test_send_outbound_notifications_records_retryable_telegram_attempts(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "bot-token")
    monkeypatch.setenv("API_BASE_URL", "http://backend:8000")
    monkeypatch.setenv("NOTIFICATION_MAX_RETRIES", "2")
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

    attempt_records: list[dict] = []

    def fake_post(url, **kwargs):
        if url == "https://api.telegram.org/botbot-token/sendVideo":
            attempt_index = len(
                [record for record in attempt_records if record["provider"] == "telegram"]
            )
            request = httpx.Request("POST", url)
            if attempt_index == 0:
                response = httpx.Response(502, text="upstream failure", request=request)
                raise httpx.HTTPStatusError(
                    "bad gateway",
                    request=request,
                    response=response,
                )
            success = MagicMock()
            success.raise_for_status = MagicMock()
            return success

        if url == "http://backend:8000/events/evt-retry/notification-attempts":
            attempt_records.append(kwargs["json"])
            response = MagicMock()
            response.raise_for_status = MagicMock()
            return response

        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(httpx, "get", MagicMock(return_value=TargetsResponse()))
    monkeypatch.setattr(httpx, "post", fake_post)

    result = send_outbound_notifications(
        NotificationPayload(
            event_id="evt-retry",
            session_id="sess-1",
            device_id="dev-1",
            summary="retry test",
            label="person",
            confidence=0.9,
            alert_reason="rule",
            inference_provider="nvidia",
            inference_model="model",
            clip_uri=None,
            clip_mime="video/webm",
            clip_data=b"video",
        )
    )

    assert result["telegram_sent"] is True
    telegram_attempts = [record for record in attempt_records if record["provider"] == "telegram"]
    assert len(telegram_attempts) == 2
    assert telegram_attempts[0]["recipient"] == "chat-a"
    assert telegram_attempts[0]["status"] == "failed"
    assert telegram_attempts[0]["retryable"] is True
    assert telegram_attempts[0]["attempt_number"] == 1
    assert telegram_attempts[0]["max_attempts"] == 3
    assert telegram_attempts[0]["failure_reason"] == "telegram status 502: upstream failure"
    assert telegram_attempts[0]["next_retry_at"] is not None
    assert telegram_attempts[1]["status"] == "succeeded"
    assert telegram_attempts[1]["retryable"] is False
    assert telegram_attempts[1]["attempt_number"] == 2
    assert telegram_attempts[1]["next_retry_at"] is None


def test_send_outbound_notifications_records_non_retryable_webhook_failure(monkeypatch):
    monkeypatch.setenv("NOTIFY_WEBHOOK_URL", "https://user:secret@example.com/hook?token=1")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)

    attempt_records: list[dict] = []

    def fake_post(url, **kwargs):
        if url == "https://user:secret@example.com/hook?token=1":
            request = httpx.Request("POST", url)
            response = httpx.Response(400, text="bad payload", request=request)
            raise httpx.HTTPStatusError("bad request", request=request, response=response)

        if url == "http://localhost:8000/events/evt-webhook/notification-attempts":
            attempt_records.append(kwargs["json"])
            response = MagicMock()
            response.raise_for_status = MagicMock()
            return response

        raise AssertionError(f"unexpected URL {url}")

    monkeypatch.setattr(httpx, "post", fake_post)

    result = send_outbound_notifications(
        NotificationPayload(
            event_id="evt-webhook",
            session_id="sess-1",
            summary="webhook retry test",
            label="person",
            confidence=0.9,
            alert_reason="rule",
            inference_provider="nvidia",
            inference_model="model",
            clip_uri=None,
            clip_mime="video/webm",
            clip_data=None,
        )
    )

    assert result["webhook_sent"] is False
    assert attempt_records == [
        {
            "provider": "webhook",
            "recipient": "https://example.com/hook",
            "status": "failed",
            "failure_reason": "webhook status 400: bad payload",
            "retryable": False,
            "attempt_number": 1,
            "max_attempts": 3,
            "attempted_at": attempt_records[0]["attempted_at"],
            "finished_at": attempt_records[0]["finished_at"],
            "next_retry_at": None,
        }
    ]

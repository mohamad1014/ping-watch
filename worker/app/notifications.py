"""Outbound notifications for alert-worthy events."""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit, urlunsplit

import httpx

logger = logging.getLogger(__name__)


@dataclass
class NotificationPayload:
    event_id: str
    session_id: str
    summary: str
    label: str | None
    confidence: float | None
    alert_reason: str | None
    inference_provider: str | None
    inference_model: str | None
    clip_uri: str | None
    clip_mime: str
    clip_data: bytes | None
    device_id: str | None = None
    should_notify: bool = True
    matched_rules: list[str] = field(default_factory=list)
    detected_entities: list[str] = field(default_factory=list)
    detected_actions: list[str] = field(default_factory=list)


def _api_base_url() -> str:
    return (os.environ.get("API_BASE_URL") or "http://localhost:8000").rstrip("/")


def _is_truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _notification_timeout() -> float:
    raw = os.environ.get("NOTIFICATION_TIMEOUT_SECONDS", "10")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 10.0


def _notification_max_retries() -> int:
    raw = os.environ.get("NOTIFICATION_MAX_RETRIES", "2")
    try:
        return max(0, int(raw))
    except ValueError:
        return 2


def _notification_retry_backoff_seconds() -> float:
    raw = os.environ.get("NOTIFICATION_RETRY_BACKOFF_SECONDS", "0")
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 0.0


def _api_auth_headers() -> dict[str, str] | None:
    token = (os.environ.get("WORKER_API_TOKEN") or "").strip()
    if not token:
        return None
    return {"Authorization": f"Bearer {token}"}


def _normalize_video_mime(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "video/webm"
    return raw.split(";", 1)[0].strip() or "video/webm"


def _truncate(value: str, limit: int = 300) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "...(truncated)"


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_dt(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _sanitize_webhook_recipient(webhook_url: str) -> str:
    parsed = urlsplit(webhook_url)
    hostname = parsed.hostname or ""
    if parsed.port is not None:
        hostname = f"{hostname}:{parsed.port}"
    return urlunsplit((parsed.scheme, hostname, parsed.path, "", ""))


def _is_retryable_exception(exc: Exception) -> bool:
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code >= 500 or exc.response.status_code == 429
    return isinstance(exc, httpx.RequestError)


def _build_failure_reason(provider: str, exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        return _truncate(
            f"{provider} status {exc.response.status_code}: {exc.response.text.strip()}"
        )
    return _truncate(f"{provider} request error: {exc}")


def _record_notification_attempt(
    payload: NotificationPayload,
    *,
    provider: str,
    recipient: str,
    status: str,
    failure_reason: str | None,
    retryable: bool,
    attempt_number: int,
    max_attempts: int,
    attempted_at: datetime,
    finished_at: datetime,
    next_retry_at: datetime | None,
) -> None:
    try:
        response = httpx.post(
            f"{_api_base_url()}/events/{payload.event_id}/notification-attempts",
            json={
                "provider": provider,
                "recipient": recipient,
                "status": status,
                "failure_reason": failure_reason,
                "retryable": retryable,
                "attempt_number": attempt_number,
                "max_attempts": max_attempts,
                "attempted_at": _format_dt(attempted_at),
                "finished_at": _format_dt(finished_at),
                "next_retry_at": _format_dt(next_retry_at),
            },
            headers=_api_auth_headers(),
            timeout=_notification_timeout(),
        )
        response.raise_for_status()
    except Exception as exc:
        logger.warning(
            "Failed to record notification attempt for event %s provider %s recipient %s: %s",
            payload.event_id,
            provider,
            recipient,
            exc,
        )


def _deliver_with_retries(
    payload: NotificationPayload,
    *,
    provider: str,
    recipient: str,
    send_once,
) -> bool:
    max_attempts = _notification_max_retries() + 1
    retry_delay_seconds = _notification_retry_backoff_seconds()

    for attempt_number in range(1, max_attempts + 1):
        attempted_at = _utc_now()
        try:
            send_once()
            finished_at = _utc_now()
            _record_notification_attempt(
                payload,
                provider=provider,
                recipient=recipient,
                status="succeeded",
                failure_reason=None,
                retryable=False,
                attempt_number=attempt_number,
                max_attempts=max_attempts,
                attempted_at=attempted_at,
                finished_at=finished_at,
                next_retry_at=None,
            )
            return True
        except Exception as exc:
            finished_at = _utc_now()
            retryable = _is_retryable_exception(exc) and attempt_number < max_attempts
            next_retry_at = (
                finished_at + timedelta(seconds=retry_delay_seconds)
                if retryable
                else None
            )
            _record_notification_attempt(
                payload,
                provider=provider,
                recipient=recipient,
                status="failed",
                failure_reason=_build_failure_reason(provider, exc),
                retryable=retryable,
                attempt_number=attempt_number,
                max_attempts=max_attempts,
                attempted_at=attempted_at,
                finished_at=finished_at,
                next_retry_at=next_retry_at,
            )
            if not retryable:
                raise
            logger.warning(
                "Retrying %s notification for event %s recipient %s after attempt %s/%s",
                provider,
                payload.event_id,
                recipient,
                attempt_number,
                max_attempts,
            )
            if retry_delay_seconds > 0:
                time.sleep(retry_delay_seconds)
    return False


def _build_alert_text(payload: NotificationPayload) -> str:
    confidence = (
        f"{round(payload.confidence * 100)}%" if isinstance(payload.confidence, float) else "n/a"
    )
    lines = [
        "Ping Watch alert",
        f"Event: {payload.event_id}",
        f"Label: {payload.label or 'unknown'}",
        f"Confidence: {confidence}",
        f"Summary: {payload.summary}",
    ]
    if payload.alert_reason:
        lines.append(f"Reason: {payload.alert_reason}")
    if payload.clip_uri:
        lines.append(f"Clip: {payload.clip_uri}")
    return "\n".join(lines)


def _resolve_chat_ids_for_payload(payload: NotificationPayload) -> list[str]:
    if payload.device_id:
        try:
            response = httpx.get(
                f"{_api_base_url()}/notifications/telegram/targets",
                params={"device_id": payload.device_id},
                headers=_api_auth_headers(),
                timeout=_notification_timeout(),
            )
            if response.status_code == 200:
                data = response.json()
                recipients = data.get("recipients") or []
                chat_ids = [
                    str(recipient.get("chat_id") or "").strip()
                    for recipient in recipients
                    if str(recipient.get("chat_id") or "").strip()
                ]
                if chat_ids:
                    logger.info(
                        "Resolved %s Telegram chat target(s) for event %s via device mapping (device=%s)",
                        len(chat_ids),
                        payload.event_id,
                        payload.device_id,
                    )
                    return chat_ids
                logger.info(
                    "Telegram targets response had no chat ids for event %s (device=%s)",
                    payload.event_id,
                    payload.device_id,
                )
            else:
                logger.warning(
                    "Telegram targets lookup failed for event %s (device=%s, status=%s)",
                    payload.event_id,
                    payload.device_id,
                    response.status_code,
                )
        except (httpx.RequestError, ValueError) as exc:
            logger.warning(
                "Failed to resolve Telegram targets for event %s and device %s: %s",
                payload.event_id,
                payload.device_id,
                exc,
            )

    logger.info(
        "No Telegram chat targets resolved for event %s (device=%s)",
        payload.event_id,
        payload.device_id or "n/a",
    )
    return []


def _send_telegram_video_once(
    payload: NotificationPayload,
    *,
    token: str,
    base_url: str,
    timeout: float,
    chat_id: str,
    caption: str,
) -> None:
    endpoint = f"{base_url}/bot{token}/sendVideo"
    filename = f"clip-{payload.event_id}.webm"
    mime = _normalize_video_mime(payload.clip_mime)
    response = httpx.post(
        endpoint,
        data={
            "chat_id": chat_id,
            "caption": caption,
            "supports_streaming": "true",
        },
        files={
            "video": (
                filename,
                payload.clip_data,
                mime,
            )
        },
        timeout=timeout,
    )
    response.raise_for_status()


def _send_telegram_text_once(
    *,
    token: str,
    base_url: str,
    timeout: float,
    chat_id: str,
    caption: str,
) -> None:
    endpoint = f"{base_url}/bot{token}/sendMessage"
    response = httpx.post(
        endpoint,
        json={
            "chat_id": chat_id,
            "text": caption,
            "disable_web_page_preview": True,
        },
        timeout=timeout,
    )
    response.raise_for_status()


def _send_telegram_notification(payload: NotificationPayload) -> bool:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_ids = _resolve_chat_ids_for_payload(payload)
    if not token or not chat_ids:
        logger.info(
            "Telegram notification skipped for event %s: token_configured=%s recipient_count=%s",
            payload.event_id,
            bool(token),
            len(chat_ids),
        )
        return False

    base_url = os.environ.get("TELEGRAM_API_BASE_URL", "https://api.telegram.org").rstrip("/")
    timeout = _notification_timeout()
    caption = _build_alert_text(payload)
    delivered = False

    send_video = _is_truthy(os.environ.get("TELEGRAM_SEND_VIDEO"), default=True)
    for chat_id in chat_ids:
        if send_video and payload.clip_data:
            logger.info(
                "Sending Telegram video alert for event %s to chat %s (clip_bytes=%s)",
                payload.event_id,
                chat_id,
                len(payload.clip_data),
            )
            try:
                delivered = _deliver_with_retries(
                    payload,
                    provider="telegram",
                    recipient=chat_id,
                    send_once=lambda: _send_telegram_video_once(
                        payload,
                        token=token,
                        base_url=base_url,
                        timeout=timeout,
                        chat_id=chat_id,
                        caption=caption,
                    ),
                )
                if delivered:
                    logger.info(
                        "Telegram video alert sent for event %s to chat %s",
                        payload.event_id,
                        chat_id,
                    )
                continue
            except httpx.HTTPStatusError as exc:
                logger.error(
                    "Telegram video alert failed for event %s chat %s: status=%s body=%s",
                    payload.event_id,
                    chat_id,
                    exc.response.status_code,
                    _truncate(exc.response.text),
                )
                continue
            except httpx.RequestError as exc:
                logger.error(
                    "Telegram video alert request failed for event %s chat %s: %s",
                    payload.event_id,
                    chat_id,
                    exc,
                )
                continue

        logger.info("Sending Telegram text alert for event %s to chat %s", payload.event_id, chat_id)
        try:
            sent = _deliver_with_retries(
                payload,
                provider="telegram",
                recipient=chat_id,
                send_once=lambda: _send_telegram_text_once(
                    token=token,
                    base_url=base_url,
                    timeout=timeout,
                    chat_id=chat_id,
                    caption=caption,
                ),
            )
            if sent:
                logger.info(
                    "Telegram text alert sent for event %s to chat %s",
                    payload.event_id,
                    chat_id,
                )
                delivered = True
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Telegram text alert failed for event %s chat %s: status=%s body=%s",
                payload.event_id,
                chat_id,
                exc.response.status_code,
                _truncate(exc.response.text),
            )
        except httpx.RequestError as exc:
            logger.error(
                "Telegram text alert request failed for event %s chat %s: %s",
                payload.event_id,
                chat_id,
                exc,
            )

    return delivered


def _send_webhook_notification(payload: NotificationPayload) -> bool:
    webhook_url = (os.environ.get("NOTIFY_WEBHOOK_URL") or "").strip()
    if not webhook_url:
        logger.info("Webhook notification skipped for event %s: webhook not configured", payload.event_id)
        return False

    timeout = _notification_timeout()
    headers = {"Content-Type": "application/json"}
    secret = (os.environ.get("NOTIFY_WEBHOOK_SECRET") or "").strip()
    if secret:
        headers["X-Ping-Watch-Webhook-Secret"] = secret

    logger.info("Sending webhook alert for event %s", payload.event_id)
    try:
        delivered = _deliver_with_retries(
            payload,
            provider="webhook",
            recipient=_sanitize_webhook_recipient(webhook_url),
            send_once=lambda: httpx.post(
                webhook_url,
                json={
                    "event_id": payload.event_id,
                    "session_id": payload.session_id,
                    "should_notify": payload.should_notify,
                    "label": payload.label,
                    "confidence": payload.confidence,
                    "summary": payload.summary,
                    "alert_reason": payload.alert_reason,
                    "matched_rules": payload.matched_rules,
                    "detected_entities": payload.detected_entities,
                    "detected_actions": payload.detected_actions,
                    "inference_provider": payload.inference_provider,
                    "inference_model": payload.inference_model,
                    "clip_uri": payload.clip_uri,
                    "clip_mime": _normalize_video_mime(payload.clip_mime),
                },
                headers=headers,
                timeout=timeout,
            ).raise_for_status(),
        )
        if delivered:
            logger.info("Webhook alert sent for event %s", payload.event_id)
            return True
        return False
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Webhook alert failed for event %s: status=%s body=%s",
            payload.event_id,
            exc.response.status_code,
            _truncate(exc.response.text),
        )
        raise
    except httpx.RequestError as exc:
        logger.error("Webhook alert request failed for event %s: %s", payload.event_id, exc)
        raise


def send_outbound_notifications(payload: NotificationPayload) -> dict[str, bool]:
    """Best-effort alert delivery via Telegram and webhook."""
    delivered = {
        "telegram_sent": False,
        "webhook_sent": False,
    }

    telegram_configured = bool((os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip())
    webhook_configured = bool((os.environ.get("NOTIFY_WEBHOOK_URL") or "").strip())
    logger.info(
        "Notification dispatch requested for event %s: should_notify=%s telegram_configured=%s webhook_configured=%s",
        payload.event_id,
        payload.should_notify,
        telegram_configured,
        webhook_configured,
    )

    if not payload.should_notify:
        logger.info(
            "Skipping outbound notifications for event %s because should_notify=false",
            payload.event_id,
        )
        return delivered

    if not telegram_configured and not webhook_configured:
        logger.warning("No outbound notification channels configured for event %s", payload.event_id)
        return delivered

    try:
        delivered["telegram_sent"] = _send_telegram_notification(payload)
    except Exception as exc:
        logger.warning("Telegram notification failed for event %s: %s", payload.event_id, exc)

    try:
        delivered["webhook_sent"] = _send_webhook_notification(payload)
    except Exception as exc:
        logger.warning("Webhook notification failed for event %s: %s", payload.event_id, exc)

    logger.info(
        "Notification dispatch finished for event %s: telegram_sent=%s webhook_sent=%s",
        payload.event_id,
        delivered["telegram_sent"],
        delivered["webhook_sent"],
    )
    return delivered

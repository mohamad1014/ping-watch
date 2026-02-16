"""Outbound notifications for alert-worthy events."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field

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


def _normalize_video_mime(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "video/webm"
    return raw.split(";", 1)[0].strip() or "video/webm"


def _truncate(value: str, limit: int = 300) -> str:
    if len(value) <= limit:
        return value
    return value[:limit] + "...(truncated)"


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


def _resolve_chat_id_for_payload(payload: NotificationPayload) -> str | None:
    if payload.device_id:
        try:
            response = httpx.get(
                f"{_api_base_url()}/notifications/telegram/target",
                params={"device_id": payload.device_id},
                timeout=_notification_timeout(),
            )
            if response.status_code == 200:
                data = response.json()
                chat_id = str(data.get("chat_id") or "").strip()
                if chat_id:
                    logger.info(
                        "Resolved Telegram chat for event %s via device mapping (device=%s)",
                        payload.event_id,
                        payload.device_id,
                    )
                    return chat_id
                logger.info(
                    "Telegram target response had no chat id for event %s (device=%s)",
                    payload.event_id,
                    payload.device_id,
                )
            else:
                logger.warning(
                    "Telegram target lookup failed for event %s (device=%s, status=%s)",
                    payload.event_id,
                    payload.device_id,
                    response.status_code,
                )
        except (httpx.RequestError, ValueError) as exc:
            logger.warning(
                "Failed to resolve Telegram target for event %s and device %s: %s",
                payload.event_id,
                payload.device_id,
                exc,
            )

    logger.info(
        "No Telegram chat target resolved for event %s (device=%s)",
        payload.event_id,
        payload.device_id or "n/a",
    )
    return None


def _send_telegram_notification(payload: NotificationPayload) -> bool:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    chat_id = _resolve_chat_id_for_payload(payload)
    if not token or not chat_id:
        logger.info(
            "Telegram notification skipped for event %s: token_configured=%s chat_configured=%s",
            payload.event_id,
            bool(token),
            bool(chat_id),
        )
        return False

    base_url = os.environ.get("TELEGRAM_API_BASE_URL", "https://api.telegram.org").rstrip("/")
    timeout = _notification_timeout()
    caption = _build_alert_text(payload)

    send_video = _is_truthy(os.environ.get("TELEGRAM_SEND_VIDEO"), default=True)
    if send_video and payload.clip_data:
        logger.info(
            "Sending Telegram video alert for event %s (clip_bytes=%s)",
            payload.event_id,
            len(payload.clip_data),
        )
        try:
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
            logger.info("Telegram video alert sent for event %s", payload.event_id)
            return True
        except httpx.HTTPStatusError as exc:
            logger.error(
                "Telegram video alert failed for event %s: status=%s body=%s",
                payload.event_id,
                exc.response.status_code,
                _truncate(exc.response.text),
            )
            raise
        except httpx.RequestError as exc:
            logger.error("Telegram video alert request failed for event %s: %s", payload.event_id, exc)
            raise

    endpoint = f"{base_url}/bot{token}/sendMessage"
    logger.info("Sending Telegram text alert for event %s", payload.event_id)
    try:
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
        logger.info("Telegram text alert sent for event %s", payload.event_id)
        return True
    except httpx.HTTPStatusError as exc:
        logger.error(
            "Telegram text alert failed for event %s: status=%s body=%s",
            payload.event_id,
            exc.response.status_code,
            _truncate(exc.response.text),
        )
        raise
    except httpx.RequestError as exc:
        logger.error("Telegram text alert request failed for event %s: %s", payload.event_id, exc)
        raise


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
        response = httpx.post(
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
        )
        response.raise_for_status()
        logger.info("Webhook alert sent for event %s", payload.event_id)
        return True
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

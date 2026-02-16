import hashlib
import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.store import (
    create_telegram_link_attempt,
    get_device,
    get_telegram_link_attempt,
    get_telegram_link_attempt_by_token_hash,
    link_device_telegram_chat,
    mark_telegram_link_attempt_expired,
    mark_telegram_link_attempt_linked,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)
_telegram_updates_offset: int | None = None


class TelegramReadinessResponse(BaseModel):
    enabled: bool
    ready: bool
    status: str
    reason: str | None = None


class TelegramLinkStartRequest(BaseModel):
    device_id: str


class TelegramLinkStartResponse(BaseModel):
    enabled: bool
    ready: bool
    status: str
    reason: str | None = None
    attempt_id: str | None = None
    connect_url: str | None = None
    expires_at: str | None = None
    link_code: str | None = None
    fallback_command: str | None = None


class TelegramLinkStatusResponse(BaseModel):
    enabled: bool
    ready: bool
    linked: bool
    status: str
    reason: str | None = None
    attempt_id: str


class TelegramTargetResponse(BaseModel):
    enabled: bool
    linked: bool
    device_id: str
    chat_id: str | None = None


class TelegramWebhookResponse(BaseModel):
    ok: bool = True


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _notification_timeout() -> float:
    raw = os.environ.get("NOTIFICATION_TIMEOUT_SECONDS", "10")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 10.0


def _telegram_link_ttl_seconds() -> int:
    raw = os.environ.get("TELEGRAM_LINK_TOKEN_TTL_SECONDS", "600")
    try:
        return max(60, min(3600, int(raw)))
    except ValueError:
        return 600


def _normalize_absolute_url(value: str) -> str:
    raw = value.strip()
    parsed = urlparse(raw)
    if parsed.scheme:
        return raw
    if raw.startswith("//"):
        return f"https:{raw}"
    return f"https://{raw.lstrip('/')}"


def _build_connect_url(link_token: str) -> str | None:
    value = (os.environ.get("TELEGRAM_BOT_ONBOARDING_URL") or "").strip()
    if not value:
        return None

    normalized = _normalize_absolute_url(value)
    if "{start_payload}" in normalized:
        return normalized.replace("{start_payload}", link_token)
    if "{token}" in normalized:
        return normalized.replace("{token}", link_token)

    parsed = urlparse(normalized)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["start"] = [link_token]
    query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=query))


def _telegram_base_url() -> str:
    return (os.environ.get("TELEGRAM_API_BASE_URL") or "https://api.telegram.org").rstrip(
        "/"
    )


def _telegram_get_chat(token: str, chat_id: str) -> tuple[int, dict]:
    response = httpx.get(
        f"{_telegram_base_url()}/bot{token}/getChat",
        params={"chat_id": chat_id},
        timeout=_notification_timeout(),
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload


def _telegram_get_updates(token: str, offset: int | None = None) -> tuple[int, dict]:
    params: dict[str, Any] = {
        "timeout": 0,
        "limit": 100,
        "allowed_updates": '["message","edited_message"]',
    }
    if offset is not None:
        params["offset"] = offset
    response = httpx.get(
        f"{_telegram_base_url()}/bot{token}/getUpdates",
        params=params,
        timeout=_notification_timeout(),
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload


def _telegram_delete_webhook(
    token: str, *, drop_pending_updates: bool = False
) -> tuple[int, dict]:
    response = httpx.post(
        f"{_telegram_base_url()}/bot{token}/deleteWebhook",
        json={"drop_pending_updates": drop_pending_updates},
        timeout=_notification_timeout(),
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload


def _parse_telegram_command(text: str | None) -> tuple[str | None, list[str]]:
    if not text:
        return None, []
    parts = text.strip().split()
    if not parts:
        return None, []
    command = parts[0].split("@", 1)[0].lower()
    if not command.startswith("/"):
        return None, parts
    return command, parts[1:]


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _token_fingerprint(token: str) -> str:
    digest = _hash_token(token)
    return digest[:10]


def _generate_link_token() -> str:
    return secrets.token_urlsafe(24)


def _send_telegram_message(token: str, chat_id: str, text: str) -> None:
    payload: dict[str, Any] = {
        "chat_id": chat_id,
        "text": text,
    }
    try:
        response = httpx.post(
            f"{_telegram_base_url()}/bot{token}/sendMessage",
            json=payload,
            timeout=_notification_timeout(),
        )
        response.raise_for_status()
        logger.info(
            "Sent Telegram message to chat_id=%s (status=%s text_len=%s)",
            chat_id,
            response.status_code,
            len(text),
        )
    except httpx.HTTPError as exc:
        logger.warning("Failed to send Telegram message: %s", exc)


def _send_link_success_message(token: str, chat_id: str) -> None:
    _send_telegram_message(
        token,
        chat_id,
        "Ping Watch is connected. Return to Ping Watch and tap Check Telegram status.",
    )


def _extract_update_message(update: Any) -> tuple[int | None, dict[str, Any] | None]:
    if not isinstance(update, dict):
        return None, None
    update_id = update.get("update_id")
    if not isinstance(update_id, int):
        update_id = None
    message = update.get("message") or update.get("edited_message")
    if not isinstance(message, dict):
        return update_id, None
    return update_id, message


def _process_start_token(
    *,
    db: Session,
    token: str,
    source: str,
    chat_id_text: str,
    username: str | None,
    link_token: str,
    send_user_feedback: bool,
) -> bool:
    attempt = get_telegram_link_attempt_by_token_hash(db, _hash_token(link_token))
    if attempt is None:
        if send_user_feedback:
            _send_telegram_message(
                token,
                chat_id_text,
                "This link token is invalid. Start a new connection from Ping Watch.",
            )
        logger.info(
            "Telegram %s received invalid token for chat_id=%s token_fp=%s",
            source,
            chat_id_text,
            _token_fingerprint(link_token),
        )
        return False

    if attempt.status == "pending" and _ensure_utc(attempt.expires_at) < _utc_now():
        mark_telegram_link_attempt_expired(db, attempt)
        attempt = get_telegram_link_attempt(db, attempt.attempt_id) or attempt

    if attempt.status == "linked":
        if send_user_feedback:
            _send_telegram_message(
                token,
                chat_id_text,
                "This device is already linked. Return to Ping Watch and tap Check Telegram status.",
            )
        logger.info(
            "Telegram %s received already-linked token for attempt %s",
            source,
            attempt.attempt_id,
        )
        return True

    if attempt.status != "pending":
        if send_user_feedback:
            _send_telegram_message(
                token,
                chat_id_text,
                "This link token has expired. Start a new connection from Ping Watch.",
            )
        logger.info(
            "Telegram %s received expired/non-pending token for attempt %s",
            source,
            attempt.attempt_id,
        )
        return False

    link_device_telegram_chat(
        db,
        device_id=attempt.device_id,
        chat_id=chat_id_text,
        username=username,
    )
    mark_telegram_link_attempt_linked(
        db,
        attempt,
        chat_id=chat_id_text,
        username=username,
    )
    logger.info(
        "Linked Telegram chat %s to device %s via attempt %s",
        chat_id_text,
        attempt.device_id,
        attempt.attempt_id,
    )
    _send_link_success_message(token, chat_id_text)
    return True


def _process_telegram_message(
    *,
    db: Session,
    token: str,
    source: str,
    message: dict[str, Any],
    send_user_feedback: bool,
) -> bool:
    chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
    sender = message.get("from") if isinstance(message.get("from"), dict) else {}
    chat_id = chat.get("id")
    if chat_id is None:
        logger.info("Telegram %s ignored message without chat.id", source)
        return False
    chat_id_text = str(chat_id)
    username = sender.get("username") or chat.get("username")

    command, args = _parse_telegram_command(message.get("text"))
    logger.info(
        "Telegram %s parsed command=%s arg_count=%s chat_id=%s username=%s",
        source,
        command,
        len(args),
        chat_id_text,
        username,
    )
    if command != "/start":
        logger.info(
            "Telegram %s ignored unsupported command=%s chat_id=%s",
            source,
            command,
            chat_id_text,
        )
        return False

    if not args:
        if send_user_feedback:
            _send_telegram_message(
                token,
                chat_id_text,
                "Open Ping Watch and tap Connect Telegram alerts to start linking.",
            )
        logger.info("Telegram %s received /start without token for chat %s", source, chat_id_text)
        return False

    link_token = args[0].strip()
    if not link_token:
        logger.info("Telegram %s ignored blank /start token for chat %s", source, chat_id_text)
        return False

    logger.info(
        "Telegram %s /start token received chat_id=%s token_fp=%s",
        source,
        chat_id_text,
        _token_fingerprint(link_token),
    )
    return _process_start_token(
        db=db,
        token=token,
        source=source,
        chat_id_text=chat_id_text,
        username=username,
        link_token=link_token,
        send_user_feedback=send_user_feedback,
    )


def _sync_telegram_link_updates(db: Session, token: str) -> None:
    global _telegram_updates_offset

    try:
        status_code, payload = _telegram_get_updates(token, offset=_telegram_updates_offset)
    except httpx.RequestError as exc:
        logger.warning("Telegram getUpdates request failed: %s", exc)
        return

    if status_code == 409:
        logger.info(
            "Telegram getUpdates conflict; deleting webhook and retrying (description=%s)",
            payload.get("description"),
        )
        try:
            delete_status, delete_payload = _telegram_delete_webhook(
                token, drop_pending_updates=False
            )
        except httpx.RequestError as exc:
            logger.warning("Telegram deleteWebhook request failed: %s", exc)
            return
        if delete_status != 200 or delete_payload.get("ok") is not True:
            logger.warning(
                "Telegram deleteWebhook failed status=%s ok=%s description=%s",
                delete_status,
                delete_payload.get("ok"),
                delete_payload.get("description"),
            )
            return
        try:
            status_code, payload = _telegram_get_updates(token, offset=_telegram_updates_offset)
        except httpx.RequestError as exc:
            logger.warning("Telegram getUpdates retry failed: %s", exc)
            return

    if status_code != 200 or payload.get("ok") is not True:
        logger.warning(
            "Telegram getUpdates failed status=%s ok=%s description=%s",
            status_code,
            payload.get("ok"),
            payload.get("description"),
        )
        return

    updates = payload.get("result")
    if not isinstance(updates, list):
        logger.info("Telegram getUpdates returned non-list result")
        return

    max_update_id: int | None = None
    linked_count = 0
    for update in updates:
        update_id, message = _extract_update_message(update)
        if update_id is not None:
            max_update_id = update_id if max_update_id is None else max(max_update_id, update_id)
        if message is None:
            continue
        if _process_telegram_message(
            db=db,
            token=token,
            source="status_poll",
            message=message,
            send_user_feedback=False,
        ):
            linked_count += 1

    if max_update_id is not None:
        _telegram_updates_offset = max_update_id + 1
    logger.info(
        "Telegram getUpdates sync processed updates=%s linked=%s next_offset=%s",
        len(updates),
        linked_count,
        _telegram_updates_offset,
    )


def _build_not_configured_response() -> TelegramReadinessResponse:
    return TelegramReadinessResponse(
        enabled=False,
        ready=False,
        status="not_configured",
        reason="Telegram bot token is not configured on the server.",
    )


def _readiness_for_device(
    *,
    db: Session,
    device_id: str,
    token: str,
) -> TelegramReadinessResponse:
    device = get_device(db, device_id)
    if device is None:
        logger.info("Telegram readiness: unknown device %s", device_id)
        return TelegramReadinessResponse(
            enabled=True,
            ready=False,
            status="unknown_device",
            reason="Device is not registered yet. Refresh and try again.",
        )

    if not device.telegram_chat_id:
        logger.info("Telegram readiness: device %s has no linked chat yet", device_id)
        return TelegramReadinessResponse(
            enabled=True,
            ready=False,
            status="needs_user_action",
            reason="Tap Connect Telegram alerts to start linking.",
        )

    try:
        status_code, payload = _telegram_get_chat(token, device.telegram_chat_id)
    except httpx.RequestError:
        logger.warning("Telegram readiness check request failed for device %s", device_id)
        return TelegramReadinessResponse(
            enabled=True,
            ready=False,
            status="error",
            reason="Unable to reach Telegram right now. Please retry in a few seconds.",
        )

    if status_code == 200 and payload.get("ok") is True:
        logger.info(
            "Telegram readiness: device %s linked chat_id=%s is reachable",
            device_id,
            device.telegram_chat_id,
        )
        return TelegramReadinessResponse(
            enabled=True,
            ready=True,
            status="ready",
            reason=None,
        )

    if status_code in {400, 403}:
        description = payload.get("description")
        logger.info(
            "Telegram readiness: device %s chat_id=%s requires relink (status=%s description=%s)",
            device_id,
            device.telegram_chat_id,
            status_code,
            description,
        )
        return TelegramReadinessResponse(
            enabled=True,
            ready=False,
            status="needs_user_action",
            reason=(
                "Telegram chat is not reachable yet. Tap Connect Telegram alerts to re-link."
                if not description
                else f"{description}. Tap Connect Telegram alerts to re-link."
            ),
        )

    logger.warning(
        "Telegram readiness: device %s unexpected getChat result status=%s payload_ok=%s",
        device_id,
        status_code,
        payload.get("ok"),
    )
    return TelegramReadinessResponse(
        enabled=True,
        ready=False,
        status="error",
        reason=f"Telegram check failed with status {status_code}.",
    )


@router.get("/telegram/readiness")
def telegram_readiness(
    device_id: str,
    db: Session = Depends(get_db),
) -> TelegramReadinessResponse:
    logger.info("Telegram readiness requested for device %s", device_id)
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        logger.info("Telegram readiness requested but TELEGRAM_BOT_TOKEN is missing")
        return _build_not_configured_response()
    response = _readiness_for_device(db=db, device_id=device_id, token=token)
    logger.info(
        "Telegram readiness result device=%s enabled=%s ready=%s status=%s",
        device_id,
        response.enabled,
        response.ready,
        response.status,
    )
    return response


@router.post("/telegram/link/start")
def telegram_link_start(
    payload: TelegramLinkStartRequest,
    db: Session = Depends(get_db),
) -> TelegramLinkStartResponse:
    logger.info("Telegram link start requested for device %s", payload.device_id)
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        logger.warning("Telegram link start blocked: TELEGRAM_BOT_TOKEN is missing")
        return TelegramLinkStartResponse(
            enabled=False,
            ready=False,
            status="not_configured",
            reason="Telegram bot token is not configured on the server.",
        )

    device = get_device(db, payload.device_id)
    if device is None:
        logger.info("Telegram link start requested for unknown device %s", payload.device_id)
        return TelegramLinkStartResponse(
            enabled=True,
            ready=False,
            status="unknown_device",
            reason="Device is not registered yet. Refresh and try again.",
        )

    link_token = _generate_link_token()
    connect_url = _build_connect_url(link_token)
    if not connect_url:
        logger.warning("Telegram link start missing TELEGRAM_BOT_ONBOARDING_URL")
        return TelegramLinkStartResponse(
            enabled=True,
            ready=False,
            status="error",
            reason="Telegram onboarding URL is not configured.",
        )

    expires_at = _utc_now() + timedelta(seconds=_telegram_link_ttl_seconds())
    attempt = create_telegram_link_attempt(
        db,
        device_id=payload.device_id,
        token_hash=_hash_token(link_token),
        expires_at=expires_at,
    )
    logger.info(
        "Created Telegram link attempt %s for device %s (expires_at=%s token_fp=%s)",
        attempt.attempt_id,
        payload.device_id,
        expires_at.isoformat(),
        _token_fingerprint(link_token),
    )
    logger.info(
        "Telegram connect URL generated for device %s attempt %s token_fp=%s",
        payload.device_id,
        attempt.attempt_id,
        _token_fingerprint(link_token),
    )

    return TelegramLinkStartResponse(
        enabled=True,
        ready=False,
        status="pending",
        reason="Open Telegram and send /start from the bot chat to link this device.",
        attempt_id=attempt.attempt_id,
        connect_url=connect_url,
        expires_at=expires_at.isoformat(),
        link_code=link_token,
        fallback_command=f"/start {link_token}",
    )


@router.get("/telegram/link/status")
def telegram_link_status(
    device_id: str,
    attempt_id: str,
    db: Session = Depends(get_db),
) -> TelegramLinkStatusResponse:
    logger.info(
        "Telegram link status requested for device=%s attempt_id=%s",
        device_id,
        attempt_id,
    )
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        return TelegramLinkStatusResponse(
            enabled=False,
            ready=False,
            linked=False,
            status="not_configured",
            reason="Telegram bot token is not configured on the server.",
            attempt_id=attempt_id,
        )

    device = get_device(db, device_id)
    if device is None:
        return TelegramLinkStatusResponse(
            enabled=True,
            ready=False,
            linked=False,
            status="unknown_device",
            reason="Device is not registered yet. Refresh and try again.",
            attempt_id=attempt_id,
        )

    attempt = get_telegram_link_attempt(db, attempt_id)
    if attempt is None or attempt.device_id != device_id:
        logger.info(
            "Telegram link status stale attempt for device=%s attempt_id=%s",
            device_id,
            attempt_id,
        )
        return TelegramLinkStatusResponse(
            enabled=True,
            ready=False,
            linked=False,
            status="not_found",
            reason="This link attempt no longer exists. Start a new Telegram connection.",
            attempt_id=attempt_id,
        )

    if attempt.status == "pending":
        _sync_telegram_link_updates(db, token)
        refreshed_attempt = get_telegram_link_attempt(db, attempt_id)
        if refreshed_attempt is not None:
            attempt = refreshed_attempt

    if attempt.status == "linked":
        logger.info(
            "Telegram link status ready for device=%s attempt_id=%s chat_id=%s",
            device_id,
            attempt_id,
            attempt.chat_id,
        )
        return TelegramLinkStatusResponse(
            enabled=True,
            ready=True,
            linked=True,
            status="ready",
            reason=None,
            attempt_id=attempt_id,
        )

    if attempt.status == "pending" and _ensure_utc(attempt.expires_at) < _utc_now():
        logger.info(
            "Telegram link attempt expired during status check device=%s attempt_id=%s",
            device_id,
            attempt_id,
        )
        attempt = mark_telegram_link_attempt_expired(db, attempt)

    if attempt.status == "expired":
        logger.info(
            "Telegram link status expired for device=%s attempt_id=%s",
            device_id,
            attempt_id,
        )
        return TelegramLinkStatusResponse(
            enabled=True,
            ready=False,
            linked=False,
            status="expired",
            reason="This link attempt expired. Start a new Telegram connection.",
            attempt_id=attempt_id,
        )

    logger.info(
        "Telegram link status pending for device=%s attempt_id=%s",
        device_id,
        attempt_id,
    )
    return TelegramLinkStatusResponse(
        enabled=True,
        ready=False,
        linked=False,
        status="pending",
        reason="Waiting for Telegram link confirmation.",
        attempt_id=attempt_id,
    )


@router.post("/telegram/webhook")
async def telegram_webhook(
    request: Request,
    db: Session = Depends(get_db),
) -> TelegramWebhookResponse:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        logger.info("Telegram webhook skipped because TELEGRAM_BOT_TOKEN is missing")
        return TelegramWebhookResponse(ok=True)

    expected_secret = (os.environ.get("TELEGRAM_WEBHOOK_SECRET") or "").strip()
    if expected_secret:
        provided_secret = (request.headers.get("x-telegram-bot-api-secret-token") or "").strip()
        if provided_secret != expected_secret:
            logger.warning(
                "Telegram webhook rejected: invalid secret token (provided=%s)",
                bool(provided_secret),
            )
            raise HTTPException(status_code=401, detail="invalid webhook secret")

    try:
        payload = await request.json()
    except ValueError:
        logger.info("Telegram webhook ignored invalid JSON payload")
        return TelegramWebhookResponse(ok=True)

    if not isinstance(payload, dict):
        logger.info(
            "Telegram webhook ignored non-object payload type=%s",
            type(payload).__name__,
        )
        return TelegramWebhookResponse(ok=True)

    logger.info(
        "Telegram webhook received update_id=%s keys=%s",
        payload.get("update_id"),
        sorted(payload.keys()),
    )
    message = payload.get("message") or payload.get("edited_message")
    if not isinstance(message, dict):
        logger.info("Telegram webhook ignored update without message payload")
        return TelegramWebhookResponse(ok=True)

    _process_telegram_message(
        db=db,
        token=token,
        source="webhook",
        message=message,
        send_user_feedback=True,
    )
    return TelegramWebhookResponse(ok=True)


@router.get("/telegram/target")
def telegram_target(
    device_id: str,
    db: Session = Depends(get_db),
) -> TelegramTargetResponse:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        return TelegramTargetResponse(
            enabled=False,
            linked=False,
            device_id=device_id,
            chat_id=None,
        )

    device = get_device(db, device_id)
    if device is None or not device.telegram_chat_id:
        return TelegramTargetResponse(
            enabled=True,
            linked=False,
            device_id=device_id,
            chat_id=None,
        )

    return TelegramTargetResponse(
        enabled=True,
        linked=True,
        device_id=device_id,
        chat_id=device.telegram_chat_id,
    )

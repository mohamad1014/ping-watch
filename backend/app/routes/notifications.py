import logging
import os
from urllib.parse import parse_qs, quote_plus, urlencode, urlparse, urlunparse

import httpx
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.store import get_device, link_device_telegram_chat

router = APIRouter(prefix="/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)


class TelegramReadinessResponse(BaseModel):
    enabled: bool
    ready: bool
    status: str
    reason: str | None = None
    connect_url: str | None = None


class TelegramLinkRequest(BaseModel):
    device_id: str


class TelegramTargetResponse(BaseModel):
    enabled: bool
    linked: bool
    device_id: str
    chat_id: str | None = None


def _readiness_response(
    *,
    enabled: bool,
    ready: bool,
    status: str,
    device_id: str | None,
    reason: str | None = None,
) -> TelegramReadinessResponse:
    return TelegramReadinessResponse(
        enabled=enabled,
        ready=ready,
        status=status,
        reason=reason,
        connect_url=_connect_url(device_id) if device_id else None,
    )


def _notification_timeout() -> float:
    raw = os.environ.get("NOTIFICATION_TIMEOUT_SECONDS", "10")
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 10.0


def _connect_url(device_id: str) -> str | None:
    value = (os.environ.get("TELEGRAM_BOT_ONBOARDING_URL") or "").strip()
    if not value:
        return None

    if "{device_id}" in value:
        return value.replace("{device_id}", quote_plus(device_id))

    parsed = urlparse(value)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["start"] = [device_id]
    query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=query))


def _telegram_base_url() -> str:
    return (os.environ.get("TELEGRAM_API_BASE_URL") or "https://api.telegram.org").rstrip("/")


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


def _extract_start_payload(text: str | None) -> str | None:
    if not text:
        return None
    parts = text.strip().split()
    if not parts:
        return None
    command = parts[0]
    if not command.startswith("/start"):
        return None
    if len(parts) < 2:
        return None
    return parts[1]


def _find_chat_from_updates(token: str, device_id: str) -> tuple[str, str | None] | None:
    response = httpx.get(
        f"{_telegram_base_url()}/bot{token}/getUpdates",
        params={"timeout": "0", "limit": "100"},
        timeout=_notification_timeout(),
    )
    if response.status_code != 200:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None

    updates = payload.get("result")
    if not isinstance(updates, list):
        return None

    for update in reversed(updates):
        if not isinstance(update, dict):
            continue
        message = update.get("message") or update.get("edited_message")
        if not isinstance(message, dict):
            continue
        if _extract_start_payload(message.get("text")) != device_id:
            continue

        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        sender = message.get("from") if isinstance(message.get("from"), dict) else {}
        chat_id = chat.get("id")
        if chat_id is None:
            continue
        username = sender.get("username") or chat.get("username")
        return str(chat_id), username

    return None


def _build_not_configured_response(device_id: str | None = None) -> TelegramReadinessResponse:
    return _readiness_response(
        enabled=False,
        ready=False,
        status="not_configured",
        device_id=device_id,
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
        return _readiness_response(
            enabled=True,
            ready=False,
            status="unknown_device",
            device_id=device_id,
            reason="Device is not registered yet. Refresh and try again.",
        )

    if not device.telegram_chat_id:
        logger.info("Telegram readiness: device %s requires linking", device_id)
        return _readiness_response(
            enabled=True,
            ready=False,
            status="needs_user_action",
            device_id=device_id,
            reason="Open Telegram, send /start from this device, then tap Check Telegram status.",
        )

    try:
        status_code, payload = _telegram_get_chat(token, device.telegram_chat_id)
    except httpx.RequestError:
        logger.warning("Telegram readiness: request error for device %s", device_id)
        return _readiness_response(
            enabled=True,
            ready=False,
            status="error",
            device_id=device_id,
            reason="Unable to reach Telegram right now. Please retry in a few seconds.",
        )

    if status_code == 200 and payload.get("ok") is True:
        logger.info("Telegram readiness: ready for device %s", device_id)
        return _readiness_response(
            enabled=True,
            ready=True,
            status="ready",
            device_id=device_id,
        )

    description = payload.get("description")
    if status_code in {400, 403}:
        logger.info(
            "Telegram readiness: needs user action for device %s (status=%s description=%s)",
            device_id,
            status_code,
            description,
        )
        return _readiness_response(
            enabled=True,
            ready=False,
            status="needs_user_action",
            device_id=device_id,
            reason=(
                "Telegram chat is not reachable yet. Open Telegram and send /start, then check again."
                if not description
                else f"{description}. Send /start, then check again."
            ),
        )

    logger.warning(
        "Telegram readiness: unexpected status for device %s (status=%s)",
        device_id,
        status_code,
    )
    return _readiness_response(
        enabled=True,
        ready=False,
        status="error",
        device_id=device_id,
        reason=f"Telegram check failed with status {status_code}.",
    )


@router.get("/telegram/readiness")
def telegram_readiness(
    device_id: str,
    db: Session = Depends(get_db),
) -> TelegramReadinessResponse:
    logger.info("Telegram readiness check requested for device %s", device_id)
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        return _build_not_configured_response(device_id)
    return _readiness_for_device(db=db, device_id=device_id, token=token)


@router.post("/telegram/link")
def telegram_link(
    payload: TelegramLinkRequest,
    db: Session = Depends(get_db),
) -> TelegramReadinessResponse:
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        return _build_not_configured_response(payload.device_id)

    device = get_device(db, payload.device_id)
    if device is None:
        logger.info("Telegram link requested for unknown device %s", payload.device_id)
        return _readiness_response(
            enabled=True,
            ready=False,
            status="unknown_device",
            device_id=payload.device_id,
            reason="Device is not registered yet. Refresh and try again.",
        )

    logger.info("Attempting Telegram link for device %s", payload.device_id)
    try:
        candidate = _find_chat_from_updates(token, payload.device_id)
    except httpx.RequestError:
        logger.warning("Telegram link request error for device %s", payload.device_id)
        return _readiness_response(
            enabled=True,
            ready=False,
            status="error",
            device_id=payload.device_id,
            reason="Unable to reach Telegram right now. Please retry in a few seconds.",
        )

    if candidate is None:
        logger.info("Telegram link pending for device %s: no /start payload yet", payload.device_id)
        return _readiness_response(
            enabled=True,
            ready=False,
            status="needs_user_action",
            device_id=payload.device_id,
            reason="No /start confirmation found for this device yet.",
        )

    chat_id, username = candidate
    link_device_telegram_chat(
        db,
        device_id=payload.device_id,
        chat_id=chat_id,
        username=username,
    )
    logger.info(
        "Linked Telegram chat %s to device %s (username=%s)",
        chat_id,
        payload.device_id,
        username or "",
    )
    return _readiness_for_device(db=db, device_id=payload.device_id, token=token)


@router.get("/telegram/target")
def telegram_target(
    device_id: str,
    db: Session = Depends(get_db),
) -> TelegramTargetResponse:
    logger.info("Telegram target lookup requested for device %s", device_id)
    token = (os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip()
    if not token:
        logger.info("Telegram target lookup: integration not configured for device %s", device_id)
        return TelegramTargetResponse(
            enabled=False,
            linked=False,
            device_id=device_id,
            chat_id=None,
        )

    device = get_device(db, device_id)
    if device is None or not device.telegram_chat_id:
        logger.info("Telegram target lookup: no chat linked for device %s", device_id)
        return TelegramTargetResponse(
            enabled=True,
            linked=False,
            device_id=device_id,
            chat_id=None,
        )

    logger.info("Telegram target lookup: resolved chat for device %s", device_id)
    return TelegramTargetResponse(
        enabled=True,
        linked=True,
        device_id=device_id,
        chat_id=device.telegram_chat_id,
    )

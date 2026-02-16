import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import HTTPException, Request

from app.db import SessionLocal
from app.store import get_auth_session_by_token_hash, get_user

_PROTECTED_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_PUBLIC_WRITE_PATHS = {
    "/auth/dev/login",
    "/notifications/telegram/webhook",
}


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _ensure_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _is_truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def is_auth_required() -> bool:
    return _is_truthy(os.environ.get("AUTH_REQUIRED"), default=False)


def is_dev_login_enabled() -> bool:
    return _is_truthy(os.environ.get("AUTH_DEV_LOGIN_ENABLED"), default=True)


def token_ttl_seconds() -> int:
    raw = os.environ.get("AUTH_TOKEN_TTL_SECONDS", "86400")
    try:
        value = int(raw)
    except ValueError:
        return 86400
    return max(300, min(60 * 60 * 24 * 30, value))


def issue_auth_token() -> str:
    return secrets.token_urlsafe(32)


def hash_auth_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def compute_token_expiry() -> datetime:
    return _utc_now() + timedelta(seconds=token_ttl_seconds())


def _normalized_path(path: str) -> str:
    if path == "/":
        return path
    return path.rstrip("/")


def _extract_bearer_token(authorization: str | None) -> Optional[str]:
    if not authorization:
        return None
    value = authorization.strip()
    if not value:
        return None

    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer":
        return None
    token = token.strip()
    return token or None


def should_authenticate_request(request: Request) -> bool:
    if not is_auth_required():
        return False
    if request.method.upper() not in _PROTECTED_WRITE_METHODS:
        return False
    if _normalized_path(request.url.path) in _PUBLIC_WRITE_PATHS:
        return False
    return True


def authenticate_request(request: Request) -> tuple[str, str]:
    token = _extract_bearer_token(request.headers.get("authorization"))
    if not token:
        raise HTTPException(status_code=401, detail="missing bearer token")

    token_hash = hash_auth_token(token)
    with SessionLocal() as db:
        auth_session = get_auth_session_by_token_hash(db, token_hash)
        if auth_session is None:
            raise HTTPException(status_code=401, detail="invalid auth token")

        if auth_session.revoked_at is not None:
            raise HTTPException(status_code=401, detail="invalid auth token")

        if auth_session.expires_at is not None and _ensure_utc(
            auth_session.expires_at
        ) < _utc_now():
            raise HTTPException(status_code=401, detail="expired auth token")

        user = get_user(db, auth_session.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="invalid auth token")

        return user.user_id, auth_session.auth_session_id


def get_request_user_id(
    request: Request, *, require_when_auth_enabled: bool = False
) -> Optional[str]:
    user_id = getattr(request.state, "auth_user_id", None)
    if isinstance(user_id, str) and user_id:
        return user_id

    has_authorization_header = bool(request.headers.get("authorization"))
    if has_authorization_header:
        user_id, auth_session_id = authenticate_request(request)
        request.state.auth_user_id = user_id
        request.state.auth_session_id = auth_session_id
        return user_id

    if require_when_auth_enabled and is_auth_required():
        raise HTTPException(status_code=401, detail="missing bearer token")

    return None

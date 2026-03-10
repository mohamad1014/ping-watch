import os

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth import (
    compute_token_expiry,
    hash_auth_token,
    is_dev_login_enabled,
    issue_auth_token,
)
from app.db import SessionLocal
from app.store import create_auth_session, create_user, get_user, get_user_by_email

router = APIRouter(prefix="/auth", tags=["auth"])
DEV_LOGIN_ROUTE_PATH = "/auth/dev/login"


class DevLoginRequest(BaseModel):
    user_id: str | None = None
    email: str | None = None


def _clamped_int_env(name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def dev_login_rate_limit_max_requests() -> int:
    return _clamped_int_env(
        "AUTH_DEV_LOGIN_RATE_LIMIT_MAX_REQUESTS",
        default=10,
        minimum=1,
        maximum=100,
    )


def dev_login_rate_limit_window_seconds() -> int:
    return _clamped_int_env(
        "AUTH_DEV_LOGIN_RATE_LIMIT_WINDOW_SECONDS",
        default=60,
        minimum=1,
        maximum=3600,
    )


@router.post("/dev/login")
async def dev_login(payload: DevLoginRequest):
    if not is_dev_login_enabled():
        raise HTTPException(status_code=404, detail="not found")

    normalized_email = payload.email.strip().lower() if payload.email else None

    with SessionLocal() as db:
        user = None
        if normalized_email:
            user = get_user_by_email(db, normalized_email)
        if user is None and payload.user_id:
            user = get_user(db, payload.user_id)

        if user is None:
            user = create_user(
                db,
                user_id=payload.user_id,
                email=normalized_email,
            )

        token = issue_auth_token()
        expires_at = compute_token_expiry()
        create_auth_session(
            db,
            user_id=user.user_id,
            token_hash=hash_auth_token(token),
            expires_at=expires_at,
        )
        user_id = user.user_id

    return {
        "access_token": token,
        "token_type": "bearer",
        "user_id": user_id,
        "expires_at": expires_at.isoformat(),
    }

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


class DevLoginRequest(BaseModel):
    user_id: str | None = None
    email: str | None = None


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

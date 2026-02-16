from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_request_user_id
from app.db import get_db
from app.store import device_to_dict, register_device

router = APIRouter(prefix="/devices", tags=["devices"])


class RegisterDeviceRequest(BaseModel):
    device_id: str | None = None
    label: str | None = None


@router.post("/register")
async def register_device_endpoint(
    payload: RegisterDeviceRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_request_user_id(request, require_when_auth_enabled=True)
    try:
        record = register_device(
            db,
            payload.device_id,
            payload.label,
            user_id=user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return device_to_dict(record)

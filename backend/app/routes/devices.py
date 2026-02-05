from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.store import device_to_dict, register_device

router = APIRouter(prefix="/devices", tags=["devices"])


class RegisterDeviceRequest(BaseModel):
    device_id: str | None = None
    label: str | None = None


@router.post("/register")
async def register_device_endpoint(
    payload: RegisterDeviceRequest, db: Session = Depends(get_db)
):
    record = register_device(db, payload.device_id, payload.label)
    return device_to_dict(record)

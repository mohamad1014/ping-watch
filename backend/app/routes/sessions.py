from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.store import create_session, session_to_dict, stop_session

router = APIRouter(prefix="/sessions", tags=["sessions"])


class StartSessionRequest(BaseModel):
    device_id: str


class StopSessionRequest(BaseModel):
    session_id: str


@router.post("/start")
async def start_session(payload: StartSessionRequest):
    record = create_session(payload.device_id)
    return session_to_dict(record)


@router.post("/stop")
async def stop_session_endpoint(payload: StopSessionRequest):
    record = stop_session(payload.session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_to_dict(record)

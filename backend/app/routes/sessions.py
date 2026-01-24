from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.store import create_session, list_sessions, session_to_dict, stop_session

router = APIRouter(prefix="/sessions", tags=["sessions"])


class StartSessionRequest(BaseModel):
    device_id: str


class StopSessionRequest(BaseModel):
    session_id: str


@router.post("/start")
async def start_session(payload: StartSessionRequest, db: Session = Depends(get_db)):
    record = create_session(db, payload.device_id)
    return session_to_dict(record)


@router.post("/stop")
async def stop_session_endpoint(
    payload: StopSessionRequest, db: Session = Depends(get_db)
):
    record = stop_session(db, payload.session_id)
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_to_dict(record)


@router.get("")
async def list_sessions_endpoint(
    device_id: str | None = Query(default=None), db: Session = Depends(get_db)
):
    sessions = list_sessions(db, device_id=device_id)
    return [session_to_dict(session) for session in sessions]

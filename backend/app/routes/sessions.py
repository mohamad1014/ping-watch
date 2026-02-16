from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth import get_request_user_id
from app.db import get_db
from app.queue import cancel_session_jobs
from app.store import (
    create_session,
    delete_processing_events_for_session,
    list_sessions,
    session_to_dict,
    stop_session,
)

router = APIRouter(prefix="/sessions", tags=["sessions"])


class StartSessionRequest(BaseModel):
    device_id: str
    analysis_prompt: str | None = None


class StopSessionRequest(BaseModel):
    session_id: str


@router.post("/start")
async def start_session(
    payload: StartSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_request_user_id(request, require_when_auth_enabled=True)
    record = create_session(
        db,
        payload.device_id,
        payload.analysis_prompt,
        user_id=user_id,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="device not found")
    return session_to_dict(record)


@router.post("/stop")
async def stop_session_endpoint(
    payload: StopSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_request_user_id(request, require_when_auth_enabled=True)
    record = stop_session(db, payload.session_id, user_id=user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")
    return session_to_dict(record)


@router.post("/force-stop")
async def force_stop_session_endpoint(
    payload: StopSessionRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    user_id = get_request_user_id(request, require_when_auth_enabled=True)
    record = stop_session(db, payload.session_id, user_id=user_id)
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")

    dropped_queued_jobs = cancel_session_jobs(payload.session_id)
    dropped_processing_events = delete_processing_events_for_session(
        db, payload.session_id, user_id=user_id
    )

    response = session_to_dict(record)
    response["dropped_processing_events"] = dropped_processing_events
    response["dropped_queued_jobs"] = dropped_queued_jobs
    return response


@router.get("")
async def list_sessions_endpoint(
    request: Request,
    device_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
):
    user_id = get_request_user_id(request, require_when_auth_enabled=True)
    sessions = list_sessions(db, device_id=device_id, user_id=user_id)
    return [session_to_dict(session) for session in sessions]

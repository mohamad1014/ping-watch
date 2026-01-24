from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.store import (
    create_event,
    event_to_dict,
    get_event,
    list_events,
    update_event_summary,
)

router = APIRouter(prefix="/events", tags=["events"])


class CreateEventRequest(BaseModel):
    session_id: str
    device_id: str
    trigger_type: str
    duration_seconds: float
    clip_uri: str
    clip_mime: str
    clip_size_bytes: int


class EventSummaryRequest(BaseModel):
    summary: str
    label: str | None = None
    confidence: float | None = None


@router.post("")
async def create_event_endpoint(
    payload: CreateEventRequest, db: Session = Depends(get_db)
):
    record = create_event(
        db,
        payload.session_id,
        payload.device_id,
        payload.trigger_type,
        payload.duration_seconds,
        payload.clip_uri,
        payload.clip_mime,
        payload.clip_size_bytes,
    )
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")
    return event_to_dict(record)


@router.get("")
async def list_events_endpoint(
    session_id: str | None = Query(default=None), db: Session = Depends(get_db)
):
    events = list_events(db, session_id=session_id)
    return [event_to_dict(event) for event in events]


@router.post("/{event_id}/summary")
async def update_event_summary_endpoint(
    event_id: str, payload: EventSummaryRequest, db: Session = Depends(get_db)
):
    record = update_event_summary(
        db, event_id, payload.summary, payload.label, payload.confidence
    )
    if record is None:
        raise HTTPException(status_code=404, detail="event not found")
    return event_to_dict(record)


@router.get("/{event_id}/summary")
async def get_event_summary_endpoint(
    event_id: str, db: Session = Depends(get_db)
):
    record = get_event(db, event_id)
    if record is None or record.summary is None:
        raise HTTPException(status_code=404, detail="event summary not found")
    return {
        "event_id": record.event_id,
        "summary": record.summary,
        "label": record.label,
        "confidence": record.confidence,
    }

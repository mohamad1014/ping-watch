from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.store import create_event, event_to_dict, list_events

router = APIRouter(prefix="/events", tags=["events"])


class CreateEventRequest(BaseModel):
    session_id: str
    device_id: str
    trigger_type: str


@router.post("")
async def create_event_endpoint(payload: CreateEventRequest):
    record = create_event(payload.session_id, payload.device_id, payload.trigger_type)
    if record is None:
        raise HTTPException(status_code=404, detail="session not found")
    return event_to_dict(record)


@router.get("")
async def list_events_endpoint(session_id: str | None = Query(default=None)):
    events = list_events(session_id=session_id)
    return [event_to_dict(event) for event in events]

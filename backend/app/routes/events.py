from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import uuid4
import anyio

from app.azurite_sas import (
    build_blob_name,
    build_blob_url,
    ensure_container_exists,
    generate_blob_upload_sas,
    load_config,
)
from app.db import get_db
from app.store import (
    create_event,
    event_to_dict,
    get_event,
    list_events,
    mark_event_clip_uploaded,
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


class InitiateUploadRequest(BaseModel):
    event_id: str | None = None
    session_id: str
    device_id: str
    trigger_type: str
    duration_seconds: float
    clip_mime: str
    clip_size_bytes: int


class FinalizeUploadRequest(BaseModel):
    etag: str | None = None


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


@router.post("/upload/initiate")
async def initiate_upload_endpoint(
    payload: InitiateUploadRequest, db: Session = Depends(get_db)
):
    try:
        config = load_config()
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    event_id = payload.event_id or str(uuid4())
    blob_name = build_blob_name(payload.session_id, event_id, payload.clip_mime)
    blob_url = build_blob_url(config, blob_name)
    sas_query, expiry = generate_blob_upload_sas(config=config, blob_name=blob_name)
    upload_url = f"{blob_url}?{sas_query}"

    if config.auto_create_container:
        try:
            await anyio.to_thread.run_sync(ensure_container_exists, config)
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail=f"failed to ensure container exists: {exc}"
            ) from exc

    try:
        record = create_event(
            db,
            payload.session_id,
            payload.device_id,
            payload.trigger_type,
            payload.duration_seconds,
            blob_url,
            payload.clip_mime,
            payload.clip_size_bytes,
            event_id=event_id,
            clip_container=config.container,
            clip_blob_name=blob_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(status_code=404, detail="session not found")

    return {
        "event": event_to_dict(record),
        "upload_url": upload_url,
        "blob_url": blob_url,
        "expires_at": expiry.isoformat(),
    }


@router.post("/{event_id}/upload/finalize")
async def finalize_upload_endpoint(
    event_id: str, payload: FinalizeUploadRequest, db: Session = Depends(get_db)
):
    record = mark_event_clip_uploaded(db, event_id, payload.etag)
    if record is None:
        raise HTTPException(status_code=404, detail="event not found")
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

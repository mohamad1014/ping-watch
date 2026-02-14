from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import uuid4
import anyio
import hashlib
import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

from app.azurite_sas import (
    build_blob_name,
    build_blob_url,
    ensure_container_exists,
    generate_blob_upload_sas,
    load_config,
)
from app.db import get_db
from app.queue import enqueue_inference_job
from app.store import (
    create_event,
    event_to_dict,
    get_event,
    get_session,
    list_events,
    mark_event_clip_uploaded,
    mark_event_clip_uploaded_via_local_api,
    update_event_summary,
)

router = APIRouter(prefix="/events", tags=["events"])
logger = logging.getLogger(__name__)


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
    inference_provider: str | None = None
    inference_model: str | None = None
    should_notify: bool | None = None
    alert_reason: str | None = None
    matched_rules: list[str] | None = None
    detected_entities: list[str] | None = None
    detected_actions: list[str] | None = None


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


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _get_local_upload_dir() -> Path:
    configured = os.environ.get("LOCAL_UPLOAD_DIR")
    if not configured:
        return _repo_root() / ".local_uploads"

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return _repo_root() / path


def _build_local_upload_info(request: Request, event_id: str, blob_name: str) -> dict[str, str]:
    upload_url = str(request.base_url).rstrip("/") + f"/events/{event_id}/upload"
    return {
        "upload_url": upload_url,
        "blob_url": upload_url,
        "clip_container": "local",
        "clip_blob_name": blob_name,
        "clip_uri": f"local://{blob_name}",
    }


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
    payload: InitiateUploadRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    event_id = payload.event_id or str(uuid4())
    blob_name = build_blob_name(payload.session_id, event_id, payload.clip_mime)
    expiry = _utc_now() + timedelta(seconds=900)
    upload_info = _build_local_upload_info(request, event_id, blob_name)

    config = None
    try:
        config = load_config()
    except RuntimeError:
        config = None

    if config is not None:
        if config.auto_create_container:
            try:
                await anyio.to_thread.run_sync(ensure_container_exists, config)
            except Exception as exc:
                logger.warning(
                    "Falling back to local uploads because Azurite container init failed: %s",
                    exc,
                )
                config = None

    if config is not None:
        blob_url = build_blob_url(config, blob_name)
        sas_query, expiry = generate_blob_upload_sas(config=config, blob_name=blob_name)
        upload_info = {
            "upload_url": f"{blob_url}?{sas_query}",
            "blob_url": blob_url,
            "clip_container": config.container,
            "clip_blob_name": blob_name,
            "clip_uri": blob_url,
        }

    try:
        record = create_event(
            db,
            payload.session_id,
            payload.device_id,
            payload.trigger_type,
            payload.duration_seconds,
            upload_info["clip_uri"],
            payload.clip_mime,
            payload.clip_size_bytes,
            event_id=event_id,
            clip_container=upload_info["clip_container"],
            clip_blob_name=upload_info["clip_blob_name"],
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    if record is None:
        raise HTTPException(status_code=404, detail="session not found")

    return {
        "event": event_to_dict(record),
        "upload_url": upload_info["upload_url"],
        "blob_url": upload_info["blob_url"],
        "expires_at": expiry.isoformat(),
    }


@router.put("/{event_id}/upload")
async def upload_clip_endpoint(
    event_id: str, request: Request, db: Session = Depends(get_db)
):
    record = get_event(db, event_id)
    if record is None:
        raise HTTPException(status_code=404, detail="event not found")

    blob_name = record.clip_blob_name or build_blob_name(
        record.session_id, record.event_id, record.clip_mime
    )

    upload_root = _get_local_upload_dir().resolve()
    target_path = (upload_root / blob_name).resolve()
    try:
        target_path.relative_to(upload_root)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid upload path") from exc

    target_path.parent.mkdir(parents=True, exist_ok=True)
    body = await request.body()
    target_path.write_bytes(body)

    updated = mark_event_clip_uploaded_via_local_api(db, event_id, blob_name)
    if updated is None:
        raise HTTPException(status_code=404, detail="event not found")
    logger.info(
        "Relay upload stored locally for event %s; clip source marked as local",
        event_id,
    )

    etag = f"\"{hashlib.md5(body).hexdigest()}\""
    return Response(status_code=201, headers={"etag": etag})


@router.post("/{event_id}/upload/finalize")
async def finalize_upload_endpoint(
    event_id: str, payload: FinalizeUploadRequest, db: Session = Depends(get_db)
):
    record = mark_event_clip_uploaded(db, event_id, payload.etag)
    if record is None:
        raise HTTPException(status_code=404, detail="event not found")

    # Get session to retrieve analysis_prompt
    session = get_session(db, record.session_id)
    analysis_prompt = session.analysis_prompt if session else None

    # Enqueue inference job (fire-and-forget, don't block on queue errors)
    enqueue_inference_job(
        event_id=record.event_id,
        session_id=record.session_id,
        device_id=record.device_id,
        clip_blob_name=record.clip_blob_name or "",
        clip_container=record.clip_container or "",
        clip_mime=record.clip_mime,
        analysis_prompt=analysis_prompt,
    )

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
        db,
        event_id,
        payload.summary,
        payload.label,
        payload.confidence,
        payload.inference_provider,
        payload.inference_model,
        payload.should_notify,
        payload.alert_reason,
        payload.matched_rules,
        payload.detected_entities,
        payload.detected_actions,
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
        "inference_provider": record.inference_provider,
        "inference_model": record.inference_model,
        "should_notify": record.should_notify,
        "alert_reason": record.alert_reason,
        "matched_rules": record.matched_rules,
        "detected_entities": record.detected_entities,
        "detected_actions": record.detected_actions,
    }

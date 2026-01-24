from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import EventModel, SessionModel


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reset_store(db: Session) -> None:
    db.execute(delete(EventModel))
    db.execute(delete(SessionModel))
    db.commit()


def create_session(db: Session, device_id: str) -> SessionModel:
    record = SessionModel(
        session_id=str(uuid4()),
        device_id=device_id,
        status="active",
        started_at=_now(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def stop_session(db: Session, session_id: str) -> Optional[SessionModel]:
    record = db.get(SessionModel, session_id)
    if record is None:
        return None
    record.status = "stopped"
    record.stopped_at = _now()
    db.commit()
    db.refresh(record)
    return record


def get_session(db: Session, session_id: str) -> Optional[SessionModel]:
    return db.get(SessionModel, session_id)


def list_sessions(db: Session, device_id: Optional[str] = None) -> list[SessionModel]:
    stmt = select(SessionModel).order_by(SessionModel.started_at)
    if device_id:
        stmt = stmt.where(SessionModel.device_id == device_id)
    return list(db.scalars(stmt))


def create_event(
    db: Session, session_id: str, device_id: str, trigger_type: str
) -> Optional[EventModel]:
    session = db.get(SessionModel, session_id)
    if session is None:
        return None
    record = EventModel(
        event_id=str(uuid4()),
        session_id=session_id,
        device_id=device_id,
        status="processing",
        trigger_type=trigger_type,
        created_at=_now(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_event(db: Session, event_id: str) -> Optional[EventModel]:
    return db.get(EventModel, event_id)


def update_event_summary(
    db: Session,
    event_id: str,
    summary: str,
    label: Optional[str],
    confidence: Optional[float],
) -> Optional[EventModel]:
    record = db.get(EventModel, event_id)
    if record is None:
        return None
    record.summary = summary
    record.label = label
    record.confidence = confidence
    record.status = "done"
    db.commit()
    db.refresh(record)
    return record


def list_events(db: Session, session_id: Optional[str] = None) -> list[EventModel]:
    stmt = select(EventModel).order_by(EventModel.created_at)
    if session_id:
        stmt = stmt.where(EventModel.session_id == session_id)
    return list(db.scalars(stmt))


def _format_dt(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat()


def session_to_dict(record: SessionModel) -> dict:
    return {
        "session_id": record.session_id,
        "device_id": record.device_id,
        "status": record.status,
        "started_at": _format_dt(record.started_at),
        "stopped_at": _format_dt(record.stopped_at),
    }


def event_to_dict(record: EventModel) -> dict:
    return {
        "event_id": record.event_id,
        "session_id": record.session_id,
        "device_id": record.device_id,
        "status": record.status,
        "trigger_type": record.trigger_type,
        "created_at": _format_dt(record.created_at),
        "summary": record.summary,
        "label": record.label,
        "confidence": record.confidence,
    }

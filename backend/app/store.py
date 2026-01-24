from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4


@dataclass
class SessionRecord:
    session_id: str
    device_id: str
    status: str
    started_at: str
    stopped_at: Optional[str] = None


@dataclass
class EventRecord:
    event_id: str
    session_id: str
    device_id: str
    status: str
    trigger_type: str
    created_at: str
    summary: Optional[str] = None
    label: Optional[str] = None
    confidence: Optional[float] = None


_sessions: dict[str, SessionRecord] = {}
_session_order: list[str] = []
_events: dict[str, EventRecord] = {}
_event_order: list[str] = []


def reset_store() -> None:
    _sessions.clear()
    _session_order.clear()
    _events.clear()
    _event_order.clear()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def create_session(device_id: str) -> SessionRecord:
    session_id = str(uuid4())
    record = SessionRecord(
        session_id=session_id,
        device_id=device_id,
        status="active",
        started_at=_now_iso(),
    )
    _sessions[session_id] = record
    _session_order.append(session_id)
    return record


def stop_session(session_id: str) -> Optional[SessionRecord]:
    record = _sessions.get(session_id)
    if record is None:
        return None
    record.status = "stopped"
    record.stopped_at = _now_iso()
    return record


def get_session(session_id: str) -> Optional[SessionRecord]:
    return _sessions.get(session_id)


def list_sessions(device_id: Optional[str] = None) -> list[SessionRecord]:
    sessions = [_sessions[session_id] for session_id in _session_order]
    if device_id:
        sessions = [session for session in sessions if session.device_id == device_id]
    return sessions


def create_event(session_id: str, device_id: str, trigger_type: str) -> Optional[EventRecord]:
    if session_id not in _sessions:
        return None
    event_id = str(uuid4())
    record = EventRecord(
        event_id=event_id,
        session_id=session_id,
        device_id=device_id,
        status="processing",
        trigger_type=trigger_type,
        created_at=_now_iso(),
    )
    _events[event_id] = record
    _event_order.append(event_id)
    return record


def get_event(event_id: str) -> Optional[EventRecord]:
    return _events.get(event_id)


def update_event_summary(
    event_id: str,
    summary: str,
    label: Optional[str],
    confidence: Optional[float],
) -> Optional[EventRecord]:
    record = _events.get(event_id)
    if record is None:
        return None
    record.summary = summary
    record.label = label
    record.confidence = confidence
    record.status = "done"
    return record


def list_events(session_id: Optional[str] = None) -> list[EventRecord]:
    events = [_events[event_id] for event_id in _event_order]
    if session_id:
        events = [event for event in events if event.session_id == session_id]
    return events


def session_to_dict(record: SessionRecord) -> dict:
    return {
        "session_id": record.session_id,
        "device_id": record.device_id,
        "status": record.status,
        "started_at": record.started_at,
        "stopped_at": record.stopped_at,
    }


def event_to_dict(record: EventRecord) -> dict:
    return {
        "event_id": record.event_id,
        "session_id": record.session_id,
        "device_id": record.device_id,
        "status": record.status,
        "trigger_type": record.trigger_type,
        "created_at": record.created_at,
        "summary": record.summary,
        "label": record.label,
        "confidence": record.confidence,
    }

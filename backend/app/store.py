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


_sessions: dict[str, SessionRecord] = {}
_events: dict[str, EventRecord] = {}
_event_order: list[str] = []


def reset_store() -> None:
    _sessions.clear()
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
    }

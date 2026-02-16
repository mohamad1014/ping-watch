from datetime import datetime, timezone
from typing import Optional
from uuid import uuid4

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import (
    AuthSessionModel,
    DeviceModel,
    EventModel,
    SessionModel,
    TelegramLinkAttemptModel,
    UserModel,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def reset_store(db: Session) -> None:
    db.execute(delete(AuthSessionModel))
    db.execute(delete(TelegramLinkAttemptModel))
    db.execute(delete(EventModel))
    db.execute(delete(SessionModel))
    db.execute(delete(DeviceModel))
    db.execute(delete(UserModel))
    db.commit()


def _to_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def get_user_by_email(db: Session, email: str) -> Optional[UserModel]:
    stmt = select(UserModel).where(UserModel.email == email)
    return db.scalar(stmt)


def get_user(db: Session, user_id: str) -> Optional[UserModel]:
    return db.get(UserModel, user_id)


def create_user(
    db: Session,
    *,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
) -> UserModel:
    record = UserModel(
        user_id=user_id or str(uuid4()),
        email=email,
        created_at=_now(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def create_auth_session(
    db: Session,
    *,
    user_id: str,
    token_hash: str,
    expires_at: Optional[datetime],
) -> AuthSessionModel:
    record = AuthSessionModel(
        auth_session_id=str(uuid4()),
        user_id=user_id,
        token_hash=token_hash,
        created_at=_now(),
        expires_at=_to_utc(expires_at) if expires_at else None,
        revoked_at=None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_auth_session_by_token_hash(
    db: Session, token_hash: str
) -> Optional[AuthSessionModel]:
    stmt = select(AuthSessionModel).where(AuthSessionModel.token_hash == token_hash)
    return db.scalar(stmt)


def create_session(
    db: Session,
    device_id: str,
    analysis_prompt: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Optional[SessionModel]:
    if user_id is not None:
        device = db.get(DeviceModel, device_id)
        if device is None or device.user_id != user_id:
            return None

    record = SessionModel(
        session_id=str(uuid4()),
        device_id=device_id,
        user_id=user_id,
        status="active",
        started_at=_now(),
        analysis_prompt=analysis_prompt,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def register_device(
    db: Session,
    device_id: Optional[str] = None,
    label: Optional[str] = None,
    user_id: Optional[str] = None,
) -> DeviceModel:
    if device_id:
        existing = db.get(DeviceModel, device_id)
        if existing is not None:
            if user_id is not None and existing.user_id not in {None, user_id}:
                raise ValueError("device not found")
            if user_id is not None and existing.user_id is None:
                existing.user_id = user_id
                db.commit()
                db.refresh(existing)
            return existing
    record = DeviceModel(
        device_id=device_id or str(uuid4()),
        user_id=user_id,
        label=label,
        created_at=_now(),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def device_to_dict(record: DeviceModel) -> dict:
    return {
        "device_id": record.device_id,
        "user_id": record.user_id,
        "label": record.label,
        "telegram_chat_id": record.telegram_chat_id,
        "telegram_username": record.telegram_username,
        "telegram_linked_at": _format_dt(record.telegram_linked_at),
        "created_at": _format_dt(record.created_at),
    }


def get_device(db: Session, device_id: str) -> Optional[DeviceModel]:
    return db.get(DeviceModel, device_id)


def link_device_telegram_chat(
    db: Session,
    device_id: str,
    chat_id: str,
    username: Optional[str] = None,
    user_id: Optional[str] = None,
) -> DeviceModel:
    record = db.get(DeviceModel, device_id)
    if record is None:
        record = DeviceModel(
            device_id=device_id,
            user_id=user_id,
            label=None,
            created_at=_now(),
        )
        db.add(record)
    elif user_id is not None and record.user_id is None:
        record.user_id = user_id

    record.telegram_chat_id = chat_id
    record.telegram_username = username
    record.telegram_linked_at = _now()
    db.commit()
    db.refresh(record)
    return record


def create_telegram_link_attempt(
    db: Session,
    *,
    device_id: str,
    user_id: Optional[str],
    token_hash: str,
    expires_at: datetime,
) -> TelegramLinkAttemptModel:
    record = TelegramLinkAttemptModel(
        attempt_id=str(uuid4()),
        device_id=device_id,
        user_id=user_id,
        token_hash=token_hash,
        status="pending",
        created_at=_now(),
        expires_at=expires_at,
        linked_at=None,
        chat_id=None,
        telegram_username=None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_telegram_link_attempt(
    db: Session, attempt_id: str, user_id: Optional[str] = None
) -> Optional[TelegramLinkAttemptModel]:
    record = db.get(TelegramLinkAttemptModel, attempt_id)
    if record is None:
        return None
    if user_id is not None and record.user_id != user_id:
        return None
    return record


def get_telegram_link_attempt_by_token_hash(
    db: Session, token_hash: str
) -> Optional[TelegramLinkAttemptModel]:
    stmt = select(TelegramLinkAttemptModel).where(
        TelegramLinkAttemptModel.token_hash == token_hash
    )
    return db.scalar(stmt)


def mark_telegram_link_attempt_expired(
    db: Session, attempt: TelegramLinkAttemptModel
) -> TelegramLinkAttemptModel:
    attempt.status = "expired"
    db.commit()
    db.refresh(attempt)
    return attempt


def mark_telegram_link_attempt_linked(
    db: Session,
    attempt: TelegramLinkAttemptModel,
    *,
    chat_id: str,
    username: Optional[str] = None,
) -> TelegramLinkAttemptModel:
    attempt.status = "linked"
    attempt.linked_at = _now()
    attempt.chat_id = chat_id
    attempt.telegram_username = username
    db.commit()
    db.refresh(attempt)
    return attempt


def stop_session(
    db: Session, session_id: str, user_id: Optional[str] = None
) -> Optional[SessionModel]:
    record = db.get(SessionModel, session_id)
    if record is None:
        return None
    if user_id is not None and record.user_id != user_id:
        return None
    record.status = "stopped"
    record.stopped_at = _now()
    db.commit()
    db.refresh(record)
    return record


def get_session(db: Session, session_id: str) -> Optional[SessionModel]:
    return db.get(SessionModel, session_id)


def list_sessions(
    db: Session,
    device_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[SessionModel]:
    stmt = select(SessionModel).order_by(SessionModel.started_at)
    if user_id is not None:
        stmt = stmt.where(SessionModel.user_id == user_id)
    if device_id:
        stmt = stmt.where(SessionModel.device_id == device_id)
    return list(db.scalars(stmt))


def create_event(
    db: Session,
    session_id: str,
    device_id: str,
    trigger_type: str,
    duration_seconds: float,
    clip_uri: str,
    clip_mime: str,
    clip_size_bytes: int,
    event_id: Optional[str] = None,
    clip_container: Optional[str] = None,
    clip_blob_name: Optional[str] = None,
    user_id: Optional[str] = None,
) -> Optional[EventModel]:
    session = db.get(SessionModel, session_id)
    if session is None:
        return None
    if user_id is not None and session.user_id != user_id:
        return None
    if session.device_id != device_id:
        return None
    if event_id is not None:
        existing = db.get(EventModel, event_id)
        if existing is not None:
            if existing.session_id != session_id:
                raise ValueError("event_id already exists for a different session")
            return existing
    record = EventModel(
        event_id=event_id or str(uuid4()),
        session_id=session_id,
        user_id=session.user_id,
        device_id=device_id,
        status="processing",
        trigger_type=trigger_type,
        created_at=_now(),
        duration_seconds=duration_seconds,
        clip_uri=clip_uri,
        clip_mime=clip_mime,
        clip_size_bytes=clip_size_bytes,
        clip_container=clip_container,
        clip_blob_name=clip_blob_name,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def get_event(
    db: Session, event_id: str, user_id: Optional[str] = None
) -> Optional[EventModel]:
    record = db.get(EventModel, event_id)
    if record is None:
        return None
    if user_id is not None and record.user_id != user_id:
        return None
    return record


def update_event_summary(
    db: Session,
    event_id: str,
    summary: str,
    label: Optional[str],
    confidence: Optional[float],
    inference_provider: Optional[str],
    inference_model: Optional[str],
    should_notify: Optional[bool],
    alert_reason: Optional[str],
    matched_rules: Optional[list[str]],
    detected_entities: Optional[list[str]],
    detected_actions: Optional[list[str]],
) -> Optional[EventModel]:
    record = db.get(EventModel, event_id)
    if record is None:
        return None
    record.summary = summary
    record.label = label
    record.confidence = confidence
    record.inference_provider = inference_provider
    record.inference_model = inference_model
    record.should_notify = should_notify
    record.alert_reason = alert_reason
    record.matched_rules = matched_rules
    record.detected_entities = detected_entities
    record.detected_actions = detected_actions
    record.status = "done"
    db.commit()
    db.refresh(record)
    return record


def mark_event_clip_uploaded(
    db: Session,
    event_id: str,
    etag: Optional[str],
    user_id: Optional[str] = None,
) -> Optional[EventModel]:
    record = get_event(db, event_id, user_id=user_id)
    if record is None:
        return None
    if record.clip_uploaded_at is None:
        record.clip_uploaded_at = _now()
    if etag is not None:
        record.clip_etag = etag
    db.commit()
    db.refresh(record)
    return record


def mark_event_clip_uploaded_via_local_api(
    db: Session,
    event_id: str,
    clip_blob_name: str,
    user_id: Optional[str] = None,
) -> Optional[EventModel]:
    record = get_event(db, event_id, user_id=user_id)
    if record is None:
        return None

    changed = False
    if record.clip_container != "local":
        record.clip_container = "local"
        changed = True

    local_uri = f"local://{clip_blob_name}"
    if record.clip_uri != local_uri:
        record.clip_uri = local_uri
        changed = True

    if changed:
        db.commit()
        db.refresh(record)
    return record


def list_events(
    db: Session,
    session_id: Optional[str] = None,
    user_id: Optional[str] = None,
) -> list[EventModel]:
    stmt = select(EventModel).order_by(EventModel.created_at)
    if user_id is not None:
        stmt = stmt.where(EventModel.user_id == user_id)
    if session_id:
        stmt = stmt.where(EventModel.session_id == session_id)
    return list(db.scalars(stmt))


def delete_processing_events_for_session(
    db: Session, session_id: str, user_id: Optional[str] = None
) -> int:
    predicates = [
        EventModel.session_id == session_id,
        EventModel.status == "processing",
    ]
    if user_id is not None:
        predicates.append(EventModel.user_id == user_id)

    result = db.execute(
        delete(EventModel).where(*predicates)
    )
    db.commit()
    return int(result.rowcount or 0)


def _format_dt(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.isoformat()


def session_to_dict(record: SessionModel) -> dict:
    return {
        "session_id": record.session_id,
        "device_id": record.device_id,
        "user_id": record.user_id,
        "status": record.status,
        "started_at": _format_dt(record.started_at),
        "stopped_at": _format_dt(record.stopped_at),
        "analysis_prompt": record.analysis_prompt,
    }


def event_to_dict(record: EventModel) -> dict:
    return {
        "event_id": record.event_id,
        "session_id": record.session_id,
        "user_id": record.user_id,
        "device_id": record.device_id,
        "status": record.status,
        "trigger_type": record.trigger_type,
        "created_at": _format_dt(record.created_at),
        "duration_seconds": record.duration_seconds,
        "clip_uri": record.clip_uri,
        "clip_mime": record.clip_mime,
        "clip_size_bytes": record.clip_size_bytes,
        "clip_container": record.clip_container,
        "clip_blob_name": record.clip_blob_name,
        "clip_uploaded_at": _format_dt(record.clip_uploaded_at),
        "clip_etag": record.clip_etag,
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

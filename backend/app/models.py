from datetime import datetime
from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SessionModel(Base):
    __tablename__ = "sessions"
    __table_args__ = (
        CheckConstraint("status IN ('active', 'stopped')", name="ck_sessions_status"),
    )

    session_id: Mapped[str] = mapped_column(String, primary_key=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    stopped_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    analysis_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    events: Mapped[list["EventModel"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


class DeviceModel(Base):
    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String, primary_key=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_username: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_linked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class EventModel(Base):
    __tablename__ = "events"
    __table_args__ = (
        CheckConstraint("status IN ('processing', 'done')", name="ck_events_status"),
        CheckConstraint("duration_seconds >= 0", name="ck_events_duration"),
    )

    event_id: Mapped[str] = mapped_column(String, primary_key=True)
    session_id: Mapped[str] = mapped_column(
        ForeignKey("sessions.session_id"), index=True
    )
    device_id: Mapped[str] = mapped_column(String, index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    trigger_type: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    duration_seconds: Mapped[float] = mapped_column(Float)
    clip_uri: Mapped[str] = mapped_column(String)
    clip_mime: Mapped[str] = mapped_column(String)
    clip_size_bytes: Mapped[int] = mapped_column(Integer)
    clip_container: Mapped[str | None] = mapped_column(String, nullable=True)
    clip_blob_name: Mapped[str | None] = mapped_column(String, nullable=True)
    clip_uploaded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    clip_etag: Mapped[str | None] = mapped_column(String, nullable=True)
    summary: Mapped[str | None] = mapped_column(String, nullable=True)
    label: Mapped[str | None] = mapped_column(String, nullable=True)
    confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    inference_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    inference_model: Mapped[str | None] = mapped_column(String, nullable=True)
    should_notify: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    alert_reason: Mapped[str | None] = mapped_column(String, nullable=True)
    matched_rules: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    detected_entities: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    detected_actions: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    session: Mapped[SessionModel] = relationship(back_populates="events")


class TelegramLinkAttemptModel(Base):
    __tablename__ = "telegram_link_attempts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'linked', 'expired')",
            name="ck_telegram_link_attempts_status",
        ),
    )

    attempt_id: Mapped[str] = mapped_column(String, primary_key=True)
    device_id: Mapped[str] = mapped_column(String, index=True)
    token_hash: Mapped[str] = mapped_column(String, unique=True, index=True)
    status: Mapped[str] = mapped_column(String, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    linked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    chat_id: Mapped[str | None] = mapped_column(String, nullable=True)
    telegram_username: Mapped[str | None] = mapped_column(String, nullable=True)

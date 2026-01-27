from datetime import datetime
from sqlalchemy import CheckConstraint, DateTime, Float, ForeignKey, Integer, String
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

    events: Mapped[list["EventModel"]] = relationship(
        back_populates="session", cascade="all, delete-orphan"
    )


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

    session: Mapped[SessionModel] = relationship(back_populates="events")

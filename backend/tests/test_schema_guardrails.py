import sqlalchemy as sa
from sqlalchemy import create_engine

import pytest

from app.db import ensure_schema_compatible


def test_ensure_schema_compatible_raises_when_events_missing_inference_columns(tmp_path):
    db_path = tmp_path / "old.db"
    engine = create_engine(f"sqlite:///{db_path}", future=True)

    metadata = sa.MetaData()
    sa.Table(
        "sessions",
        metadata,
        sa.Column("session_id", sa.String(), primary_key=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
    )
    sa.Table(
        "events",
        metadata,
        sa.Column("event_id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("trigger_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("clip_uri", sa.String(), nullable=False),
        sa.Column("clip_mime", sa.String(), nullable=False),
        sa.Column("clip_size_bytes", sa.Integer(), nullable=False),
        sa.Column("clip_container", sa.String(), nullable=True),
        sa.Column("clip_blob_name", sa.String(), nullable=True),
        sa.Column("clip_uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clip_etag", sa.String(), nullable=True),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
    )
    metadata.create_all(engine)

    with pytest.raises(RuntimeError, match="alembic upgrade head"):
        ensure_schema_compatible(engine)


def test_ensure_schema_compatible_noop_when_events_table_missing(tmp_path):
    db_path = tmp_path / "empty.db"
    engine = create_engine(f"sqlite:///{db_path}", future=True)
    ensure_schema_compatible(engine)


def test_ensure_schema_compatible_raises_when_devices_missing_telegram_columns(tmp_path):
    db_path = tmp_path / "devices-old.db"
    engine = create_engine(f"sqlite:///{db_path}", future=True)

    metadata = sa.MetaData()
    sa.Table(
        "events",
        metadata,
        sa.Column("event_id", sa.String(), primary_key=True),
        sa.Column("session_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("trigger_type", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("clip_uri", sa.String(), nullable=False),
        sa.Column("clip_mime", sa.String(), nullable=False),
        sa.Column("clip_size_bytes", sa.Integer(), nullable=False),
        sa.Column("clip_container", sa.String(), nullable=True),
        sa.Column("clip_blob_name", sa.String(), nullable=True),
        sa.Column("clip_uploaded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("clip_etag", sa.String(), nullable=True),
        sa.Column("summary", sa.String(), nullable=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("inference_provider", sa.String(), nullable=True),
        sa.Column("inference_model", sa.String(), nullable=True),
        sa.Column("should_notify", sa.Boolean(), nullable=True),
        sa.Column("alert_reason", sa.String(), nullable=True),
        sa.Column("matched_rules", sa.JSON(), nullable=True),
        sa.Column("detected_entities", sa.JSON(), nullable=True),
        sa.Column("detected_actions", sa.JSON(), nullable=True),
    )
    sa.Table(
        "sessions",
        metadata,
        sa.Column("session_id", sa.String(), primary_key=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("stopped_at", sa.DateTime(timezone=True), nullable=True),
    )
    sa.Table(
        "devices",
        metadata,
        sa.Column("device_id", sa.String(), primary_key=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    metadata.create_all(engine)

    with pytest.raises(RuntimeError, match="missing columns on `devices`"):
        ensure_schema_compatible(engine)

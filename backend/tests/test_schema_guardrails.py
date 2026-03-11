import os
from pathlib import Path
import re
import sqlalchemy as sa
from sqlalchemy import create_engine

import pytest
import sqlite3
import subprocess

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
        sa.Column("queue_job_id", sa.String(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enqueue_attempt_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.Column("queue_job_id", sa.String(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enqueue_attempt_count", sa.Integer(), nullable=False, server_default="0"),
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


def test_ensure_schema_compatible_raises_when_subscription_table_missing(tmp_path):
    db_path = tmp_path / "subscriptions-old.db"
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
        sa.Column("queue_job_id", sa.String(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enqueue_attempt_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("telegram_chat_id", sa.String(), nullable=True),
        sa.Column("telegram_username", sa.String(), nullable=True),
        sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    metadata.create_all(engine)

    with pytest.raises(RuntimeError, match="device_notification_subscriptions"):
        ensure_schema_compatible(engine)


def test_ensure_schema_compatible_raises_when_notification_attempts_table_missing(tmp_path):
    db_path = tmp_path / "notification-attempts-old.db"
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
        sa.Column("queue_job_id", sa.String(), nullable=True),
        sa.Column("enqueued_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("enqueue_attempt_count", sa.Integer(), nullable=False, server_default="0"),
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
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("telegram_chat_id", sa.String(), nullable=True),
        sa.Column("telegram_username", sa.String(), nullable=True),
        sa.Column("telegram_linked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("label", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    sa.Table(
        "device_notification_subscriptions",
        metadata,
        sa.Column("subscription_id", sa.String(), primary_key=True),
        sa.Column("device_id", sa.String(), nullable=False),
        sa.Column("endpoint_id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    metadata.create_all(engine)

    with pytest.raises(RuntimeError, match="notification_attempts"):
        ensure_schema_compatible(engine)


def test_alembic_upgrade_head_recovers_from_stale_wave1_revision(tmp_path):
    repo_root = Path(__file__).resolve().parents[2]
    backend_dir = repo_root / "backend"
    db_path = tmp_path / "stale-wave1.db"
    env = {"DATABASE_URL": f"sqlite:///{db_path}"}

    upgrade_to_base = subprocess.run(
        [str(backend_dir / ".venv" / "bin" / "alembic"), "upgrade", "0011_notification_endpoints"],
        cwd=backend_dir,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        check=False,
    )
    assert upgrade_to_base.returncode == 0, upgrade_to_base.stderr

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE alembic_version SET version_num = ?",
            ("0012_event_lifecycle_states",),
        )
        connection.commit()

    upgrade_to_head = subprocess.run(
        [str(backend_dir / ".venv" / "bin" / "alembic"), "upgrade", "head"],
        cwd=backend_dir,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        check=False,
    )

    assert upgrade_to_head.returncode == 0, upgrade_to_head.stderr

    current_revision = subprocess.run(
        [str(backend_dir / ".venv" / "bin" / "alembic"), "current"],
        cwd=backend_dir,
        env={**os.environ, **env},
        capture_output=True,
        text=True,
        check=False,
    )
    assert current_revision.returncode == 0, current_revision.stderr
    assert "head" in current_revision.stdout


def test_wave1_revision_ids_fit_within_alembic_version_column_limit():
    versions_dir = Path(__file__).resolve().parents[1] / "alembic" / "versions"
    revision_pattern = re.compile(r'^revision = "([^"]+)"$', re.MULTILINE)

    for path in versions_dir.glob("*.py"):
        content = path.read_text()
        match = revision_pattern.search(content)
        if match is None:
            continue
        assert len(match.group(1)) <= 32, path.name

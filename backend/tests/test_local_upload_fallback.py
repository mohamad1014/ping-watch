import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.db import SessionLocal
from app.main import app
from app.models import EventModel


@pytest.mark.anyio
async def test_local_upload_fallback_works_without_azurite_env(monkeypatch, tmp_path):
    for key in (
        "AZURITE_BLOB_ENDPOINT",
        "AZURITE_ACCOUNT_NAME",
        "AZURITE_ACCOUNT_KEY",
        "AZURITE_CLIPS_CONTAINER",
        "AZURITE_AUTO_CREATE_CONTAINER",
    ):
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]

        initiate = await client.post(
            "/events/upload/initiate",
            json={
                "event_id": "clip-local",
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 1.0,
                "clip_mime": "video/webm",
                "clip_size_bytes": 3,
            },
        )

        assert initiate.status_code == 200
        payload = initiate.json()
        assert payload["event"]["event_id"] == "clip-local"
        assert payload["upload_url"].startswith("http://test/events/clip-local/upload")

        put = await client.put(
            "/events/clip-local/upload",
            content=b"abc",
            headers={"content-type": "video/webm"},
        )
        assert put.status_code in (200, 201)
        etag = put.headers.get("etag")
        assert etag

        finalize = await client.post(
            "/events/clip-local/upload/finalize",
            json={"etag": etag},
        )
        assert finalize.status_code == 200
        event = finalize.json()
        assert event["clip_uploaded_at"]
        assert event["clip_etag"] == etag

    saved = list(Path(tmp_path).rglob("*"))
    assert any(path.is_file() and path.name.startswith("clip-local") for path in saved)


@pytest.mark.anyio
async def test_local_upload_rejects_traversal_paths(monkeypatch, tmp_path):
    for key in (
        "AZURITE_BLOB_ENDPOINT",
        "AZURITE_ACCOUNT_NAME",
        "AZURITE_ACCOUNT_KEY",
        "AZURITE_CLIPS_CONTAINER",
        "AZURITE_AUTO_CREATE_CONTAINER",
    ):
        monkeypatch.delenv(key, raising=False)

    monkeypatch.setenv("LOCAL_UPLOAD_DIR", str(tmp_path))

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]

        initiate = await client.post(
            "/events/upload/initiate",
            json={
                "event_id": "clip-traversal",
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 1.0,
                "clip_mime": "video/webm",
                "clip_size_bytes": 3,
            },
        )
        assert initiate.status_code == 200

        with SessionLocal() as db:
            record = db.get(EventModel, "clip-traversal")
            assert record is not None
            record.clip_blob_name = "../escape"
            db.commit()

        put = await client.put(
            "/events/clip-traversal/upload",
            content=b"abc",
            headers={"content-type": "video/webm"},
        )
        assert put.status_code == 400

    assert not (tmp_path.parent / "escape").exists()

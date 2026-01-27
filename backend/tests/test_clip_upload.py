import os

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.mark.anyio
async def test_initiate_upload_returns_sas_and_creates_event():
    os.environ.setdefault(
        "AZURITE_BLOB_ENDPOINT", "http://127.0.0.1:10000/devstoreaccount1"
    )
    os.environ.setdefault("AZURITE_ACCOUNT_NAME", "devstoreaccount1")
    os.environ.setdefault(
        "AZURITE_ACCOUNT_KEY",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        response = await client.post(
            "/events/upload/initiate",
            json={
                "event_id": "clip-123",
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 3.5,
                "clip_mime": "video/webm",
                "clip_size_bytes": 1234,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["event"]["event_id"] == "clip-123"
    assert payload["event"]["status"] == "processing"
    assert payload["event"]["clip_uri"].startswith(
        "http://127.0.0.1:10000/devstoreaccount1/"
    )
    assert payload["upload_url"].startswith(payload["blob_url"])
    assert "sig=" in payload["upload_url"]
    assert payload["expires_at"]


@pytest.mark.anyio
async def test_finalize_upload_sets_uploaded_fields_and_is_idempotent():
    os.environ.setdefault(
        "AZURITE_BLOB_ENDPOINT", "http://127.0.0.1:10000/devstoreaccount1"
    )
    os.environ.setdefault("AZURITE_ACCOUNT_NAME", "devstoreaccount1")
    os.environ.setdefault(
        "AZURITE_ACCOUNT_KEY",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        initiate = await client.post(
            "/events/upload/initiate",
            json={
                "event_id": "clip-abc",
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 1.0,
                "clip_mime": "video/webm",
                "clip_size_bytes": 12,
            },
        )
        assert initiate.status_code == 200

        finalize = await client.post(
            "/events/clip-abc/upload/finalize",
            json={"etag": '"0x8DAF1234"'},
        )
        finalize_again = await client.post(
            "/events/clip-abc/upload/finalize",
            json={"etag": '"0x8DAF1234"'},
        )

    assert finalize.status_code == 200
    assert finalize_again.status_code == 200
    event = finalize.json()
    assert event["clip_etag"] == '"0x8DAF1234"'
    assert event["clip_uploaded_at"]


@pytest.mark.anyio
async def test_initiate_upload_generates_event_id_when_missing():
    os.environ.setdefault(
        "AZURITE_BLOB_ENDPOINT", "http://127.0.0.1:10000/devstoreaccount1"
    )
    os.environ.setdefault("AZURITE_ACCOUNT_NAME", "devstoreaccount1")
    os.environ.setdefault(
        "AZURITE_ACCOUNT_KEY",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    )

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        start = await client.post("/sessions/start", json={"device_id": "dev_1"})
        session_id = start.json()["session_id"]
        response = await client.post(
            "/events/upload/initiate",
            json={
                "session_id": session_id,
                "device_id": "dev_1",
                "trigger_type": "motion",
                "duration_seconds": 1.0,
                "clip_mime": "video/webm",
                "clip_size_bytes": 12,
            },
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["event"]["event_id"] != session_id

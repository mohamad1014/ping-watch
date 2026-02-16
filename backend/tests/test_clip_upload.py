import os
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.azurite_sas import AzuriteConfig
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
async def test_finalize_upload_enqueues_clip_mime():
    os.environ.setdefault(
        "AZURITE_BLOB_ENDPOINT", "http://127.0.0.1:10000/devstoreaccount1"
    )
    os.environ.setdefault("AZURITE_ACCOUNT_NAME", "devstoreaccount1")
    os.environ.setdefault(
        "AZURITE_ACCOUNT_KEY",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    )

    with patch("app.routes.events.enqueue_inference_job", return_value="job-1") as mock_enqueue:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            start = await client.post("/sessions/start", json={"device_id": "dev_1"})
            session_id = start.json()["session_id"]
            initiate = await client.post(
                "/events/upload/initiate",
                json={
                    "event_id": "clip-mime",
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
                "/events/clip-mime/upload/finalize",
                json={"etag": '"etag-1"'},
            )

    assert finalize.status_code == 200
    mock_enqueue.assert_called_once()
    assert mock_enqueue.call_args.kwargs["clip_mime"] == "video/webm"


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


@pytest.mark.anyio
async def test_relay_upload_marks_event_local_and_enqueues_local_container():
    fake_expiry = datetime.now(timezone.utc) + timedelta(minutes=15)
    fake_config = AzuriteConfig(
        endpoint="http://127.0.0.1:10000/devstoreaccount1",
        account_name="devstoreaccount1",
        account_key="Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
        container="clips",
        sas_expiry_seconds=900,
        sas_version="2020-10-02",
        sas_protocol="http",
        auto_create_container=False,
        request_timeout_seconds=2.0,
    )

    with (
        patch("app.routes.events.load_config", return_value=fake_config),
        patch("app.routes.events.generate_blob_upload_sas", return_value=("sv=2020-10-02&sig=fake", fake_expiry)),
        patch("app.routes.events.enqueue_inference_job", return_value="job-1") as mock_enqueue,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            start = await client.post("/sessions/start", json={"device_id": "dev_1"})
            session_id = start.json()["session_id"]

            initiated = await client.post(
                "/events/upload/initiate",
                json={
                    "event_id": "clip-relay",
                    "session_id": session_id,
                    "device_id": "dev_1",
                    "trigger_type": "motion",
                    "duration_seconds": 1.0,
                    "clip_mime": "video/webm",
                    "clip_size_bytes": 12,
                },
            )
            assert initiated.status_code == 200
            assert initiated.json()["event"]["clip_container"] == "clips"

            put_resp = await client.put(
                "/events/clip-relay/upload",
                content=b"fake webm bytes",
                headers={"content-type": "video/webm"},
            )
            assert put_resp.status_code == 201

            finalize = await client.post(
                "/events/clip-relay/upload/finalize",
                json={"etag": '"etag-local-relay"'},
            )

    assert finalize.status_code == 200
    event = finalize.json()
    assert event["clip_container"] == "local"
    assert event["clip_uri"].startswith("local://")
    mock_enqueue.assert_called_once()
    assert mock_enqueue.call_args.kwargs["clip_container"] == "local"

import os
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


def _seed_azurite_env() -> None:
    os.environ.setdefault(
        "AZURITE_BLOB_ENDPOINT", "http://127.0.0.1:10000/devstoreaccount1"
    )
    os.environ.setdefault("AZURITE_ACCOUNT_NAME", "devstoreaccount1")
    os.environ.setdefault(
        "AZURITE_ACCOUNT_KEY",
        "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==",
    )


@pytest.mark.anyio
async def test_finalize_upload_is_idempotent_after_successful_enqueue():
    _seed_azurite_env()

    with (
        patch("app.routes.events._uploaded_clip_exists", return_value=True),
        patch("app.routes.events.enqueue_inference_job", return_value="job-123") as mock_enqueue,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            start = await client.post("/sessions/start", json={"device_id": "dev_1"})
            session_id = start.json()["session_id"]

            initiated = await client.post(
                "/events/upload/initiate",
                json={
                    "event_id": "clip-idempotent",
                    "session_id": session_id,
                    "device_id": "dev_1",
                    "trigger_type": "motion",
                    "duration_seconds": 1.0,
                    "clip_mime": "video/webm",
                    "clip_size_bytes": 12,
                },
            )
            assert initiated.status_code == 200

            first_finalize = await client.post(
                "/events/clip-idempotent/upload/finalize",
                json={"etag": '"etag-1"'},
            )
            second_finalize = await client.post(
                "/events/clip-idempotent/upload/finalize",
                json={"etag": '"etag-1"'},
            )

    assert first_finalize.status_code == 200
    assert second_finalize.status_code == 200
    mock_enqueue.assert_called_once()

    first_payload = first_finalize.json()
    second_payload = second_finalize.json()
    assert first_payload["queue_job_id"] == "job-123"
    assert first_payload["enqueue_attempt_count"] == 1
    assert first_payload["enqueued_at"] is not None
    assert second_payload["queue_job_id"] == "job-123"
    assert second_payload["enqueue_attempt_count"] == 1
    assert second_payload["enqueued_at"] == first_payload["enqueued_at"]


@pytest.mark.anyio
async def test_finalize_upload_retries_enqueue_after_previous_failure():
    _seed_azurite_env()

    with (
        patch("app.routes.events._uploaded_clip_exists", return_value=True),
        patch(
            "app.routes.events.enqueue_inference_job",
            side_effect=[None, "job-234"],
        ) as mock_enqueue,
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            start = await client.post("/sessions/start", json={"device_id": "dev_1"})
            session_id = start.json()["session_id"]

            initiated = await client.post(
                "/events/upload/initiate",
                json={
                    "event_id": "clip-retry",
                    "session_id": session_id,
                    "device_id": "dev_1",
                    "trigger_type": "motion",
                    "duration_seconds": 1.0,
                    "clip_mime": "video/webm",
                    "clip_size_bytes": 12,
                },
            )
            assert initiated.status_code == 200

            first_finalize = await client.post(
                "/events/clip-retry/upload/finalize",
                json={"etag": '"etag-retry"'},
            )
            second_finalize = await client.post(
                "/events/clip-retry/upload/finalize",
                json={"etag": '"etag-retry"'},
            )

    assert first_finalize.status_code == 200
    assert second_finalize.status_code == 200
    assert mock_enqueue.call_count == 2

    first_payload = first_finalize.json()
    second_payload = second_finalize.json()
    assert first_payload["queue_job_id"] is None
    assert first_payload["enqueue_attempt_count"] == 1
    assert first_payload["enqueued_at"] is None

    assert second_payload["queue_job_id"] == "job-234"
    assert second_payload["enqueue_attempt_count"] == 2
    assert second_payload["enqueued_at"] is not None

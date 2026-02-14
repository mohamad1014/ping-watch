"""Tests for the backend queue integration."""

import pytest
from unittest.mock import MagicMock, patch


def test_enqueue_inference_job_success(monkeypatch):
    """Test that enqueue_inference_job successfully enqueues a job."""
    from app import queue

    mock_queue = MagicMock()
    mock_job = MagicMock()
    mock_job.id = "job_123"
    mock_queue.enqueue.return_value = mock_job

    with patch.object(queue, "get_queue", return_value=mock_queue):
        job_id = queue.enqueue_inference_job(
            event_id="evt_1",
            session_id="sess_1",
            device_id="dev_1",
            clip_blob_name="sessions/sess_1/events/evt_1.webm",
            clip_container="clips",
            clip_mime="video/webm",
            analysis_prompt="Focus on people",
        )

    assert job_id == "job_123"
    mock_queue.enqueue.assert_called_once()
    call_args = mock_queue.enqueue.call_args
    assert call_args[0][0] == "app.tasks.process_clip"
    payload = call_args[0][1]
    assert payload["event_id"] == "evt_1"
    assert payload["session_id"] == "sess_1"
    assert payload["device_id"] == "dev_1"
    assert payload["clip_mime"] == "video/webm"
    assert payload["analysis_prompt"] == "Focus on people"


def test_enqueue_inference_job_redis_unavailable(monkeypatch, caplog):
    """Test that enqueue_inference_job handles Redis unavailability gracefully."""
    from app import queue

    mock_queue = MagicMock()
    mock_queue.enqueue.side_effect = ConnectionError("Redis unavailable")

    with patch.object(queue, "get_queue", return_value=mock_queue):
        job_id = queue.enqueue_inference_job(
            event_id="evt_1",
            session_id="sess_1",
            device_id="dev_1",
            clip_blob_name="test.webm",
            clip_container="clips",
            clip_mime="video/webm",
        )

    assert job_id is None
    assert "Failed to enqueue" in caplog.text


def test_enqueue_inference_job_without_prompt(monkeypatch):
    """Test enqueueing without an analysis prompt."""
    from app import queue

    mock_queue = MagicMock()
    mock_job = MagicMock()
    mock_job.id = "job_456"
    mock_queue.enqueue.return_value = mock_job

    with patch.object(queue, "get_queue", return_value=mock_queue):
        job_id = queue.enqueue_inference_job(
            event_id="evt_2",
            session_id="sess_2",
            device_id="dev_2",
            clip_blob_name="test.webm",
            clip_container="clips",
            clip_mime="video/webm",
        )

    assert job_id == "job_456"
    payload = mock_queue.enqueue.call_args[0][1]
    assert payload["clip_mime"] == "video/webm"
    assert payload["analysis_prompt"] is None


def test_cancel_session_jobs_removes_matching_jobs():
    from app import queue

    matching_one = MagicMock()
    matching_one.args = ({"session_id": "sess_1"},)
    matching_two = MagicMock()
    matching_two.args = ({"session_id": "sess_1"},)
    other = MagicMock()
    other.args = ({"session_id": "sess_2"},)

    mock_queue = MagicMock()
    mock_queue.jobs = [matching_one, other, matching_two]

    cancelled = queue.cancel_session_jobs("sess_1", queue=mock_queue)

    assert cancelled == 2
    matching_one.cancel.assert_called_once()
    matching_two.cancel.assert_called_once()
    other.cancel.assert_not_called()


def test_cancel_session_jobs_returns_zero_on_queue_error():
    from app import queue

    with patch.object(queue, "get_queue", side_effect=RuntimeError("queue unavailable")):
        cancelled = queue.cancel_session_jobs("sess_1")

    assert cancelled == 0

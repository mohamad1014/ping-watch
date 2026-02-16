"""Tests for worker tasks module."""

from unittest.mock import MagicMock

import httpx

from app import tasks
from app.inference import InferenceResult


def build_response(url: str, payload: dict):
    request = httpx.Request("POST", url)
    return httpx.Response(200, json=payload, request=request)


def test_post_event_summary_calls_api(monkeypatch):
    """Test that post_event_summary calls the backend API."""
    response = build_response(
        "http://localhost:8000/events/evt_1/summary",
        {
            "event_id": "evt_1",
            "status": "done",
            "summary": "Motion detected",
            "label": "person",
            "confidence": 0.88,
        },
    )
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    result = tasks.post_event_summary(
        event_id="evt_1",
        summary="Motion detected",
        label="person",
        confidence=0.88,
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        should_notify=True,
        alert_reason="Matched person entering front door",
        matched_rules=["person entering front door"],
        detected_entities=["person", "door"],
        detected_actions=["entering"],
    )

    mock_post.assert_called_once()
    payload = mock_post.call_args.kwargs["json"]
    assert payload["inference_provider"] == "nvidia"
    assert payload["inference_model"] == "nvidia/nemotron-nano-12b-v2-vl"
    assert payload["should_notify"] is True
    assert payload["alert_reason"] == "Matched person entering front door"
    assert payload["matched_rules"] == ["person entering front door"]
    assert payload["detected_entities"] == ["person", "door"]
    assert payload["detected_actions"] == ["entering"]
    assert result["status"] == "done"


def test_download_clip_data_local_container(monkeypatch):
    """Test that local container uses local download."""
    mock_local = MagicMock(return_value=b"local data")
    monkeypatch.setattr(tasks, "download_local_clip", mock_local)

    result = tasks.download_clip_data("test.webm", "local")

    assert result == b"local data"
    mock_local.assert_called_once_with("test.webm")


def test_download_clip_data_blob_storage(monkeypatch):
    """Test that blob container uses blob download."""
    mock_blob = MagicMock(return_value=b"blob data")
    monkeypatch.setattr(tasks, "download_clip", mock_blob)

    result = tasks.download_clip_data("test.webm", "clips")

    assert result == b"blob data"
    mock_blob.assert_called_once_with("test.webm", "clips")


def test_download_clip_data_blob_fallback_to_local(monkeypatch):
    """Test that blob failure falls back to local download."""
    mock_blob = MagicMock(side_effect=RuntimeError("Blob unavailable"))
    mock_local = MagicMock(return_value=b"local fallback")
    monkeypatch.setattr(tasks, "download_clip", mock_blob)
    monkeypatch.setattr(tasks, "download_local_clip", mock_local)

    result = tasks.download_clip_data("test.webm", "clips")

    assert result == b"local fallback"


def test_process_clip_full_pipeline(monkeypatch):
    """Test the full process_clip pipeline."""
    # Mock all dependencies
    mock_download = MagicMock(return_value=b"video data")
    mock_extract = MagicMock(return_value=["data:image/jpeg;base64,frame1"])
    mock_inference = MagicMock(return_value=InferenceResult(
        label="person",
        summary="Person detected in frame",
        confidence=0.92,
        provider="nvidia",
        model="nvidia/nemotron-nano-12b-v2-vl",
        should_notify=True,
        alert_reason="Matched person at front door",
        matched_rules=["person at front door"],
        detected_entities=["person", "door"],
        detected_actions=["entering"],
    ))
    mock_post = MagicMock(return_value={"status": "done"})
    mock_notify = MagicMock(return_value={"telegram_sent": False, "webhook_sent": False})

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr("app.tasks.extract_frames_as_base64", mock_extract)
    monkeypatch.setattr("app.tasks.run_inference", mock_inference)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)
    monkeypatch.setattr(tasks, "send_outbound_notifications", mock_notify)

    payload = {
        "event_id": "evt_123",
        "session_id": "sess_456",
        "device_id": "dev_789",
        "clip_blob_name": "sessions/sess_456/events/evt_123.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
        "analysis_prompt": "Focus on people",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "done"
    assert result["event_id"] == "evt_123"
    assert result["label"] == "person"
    assert result["confidence"] == 0.92
    assert result["should_notify"] is True

    # Verify pipeline was called correctly
    mock_download.assert_called_once_with(
        "sessions/sess_456/events/evt_123.webm",
        "clips",
    )
    mock_extract.assert_called_once()
    mock_inference.assert_called_once()
    assert mock_inference.call_args[1]["user_prompt"] == "Focus on people"
    assert mock_inference.call_args[1]["clip_data"] == b"video data"
    assert mock_inference.call_args[1]["clip_mime"] == "video/webm"
    mock_post.assert_called_once_with(
        event_id="evt_123",
        summary="Person detected in frame",
        label="person",
        confidence=0.92,
        inference_provider="nvidia",
        inference_model="nvidia/nemotron-nano-12b-v2-vl",
        should_notify=True,
        alert_reason="Matched person at front door",
        matched_rules=["person at front door"],
        detected_entities=["person", "door"],
        detected_actions=["entering"],
    )
    mock_notify.assert_called_once()
    notify_payload = mock_notify.call_args.args[0]
    assert notify_payload.event_id == "evt_123"
    assert notify_payload.device_id == "dev_789"
    assert notify_payload.should_notify is True


def test_process_clip_missing_event_id():
    """Test that missing event_id returns error."""
    result = tasks.process_clip({})

    assert result["status"] == "error"
    assert "missing event_id" in result["error"]


def test_process_clip_error_posts_fallback_summary(monkeypatch):
    """Test that errors post a fallback summary."""
    mock_download = MagicMock(side_effect=RuntimeError("Download failed"))
    mock_post = MagicMock(return_value={"status": "done"})

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)

    payload = {
        "event_id": "evt_123",
        "session_id": "sess_456",
        "clip_blob_name": "test.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "error"
    assert "Download failed" in result["error"]

    # Verify fallback summary was posted
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args[1]
    assert call_kwargs["label"] == "error"
    assert "Processing failed" in call_kwargs["summary"]


def test_process_clip_auth_error_logs_without_traceback(monkeypatch):
    """Test that auth failures avoid noisy traceback logging."""
    mock_download = MagicMock(return_value=b"video data")
    mock_extract = MagicMock(return_value=["data:image/jpeg;base64,frame1"])
    mock_inference = MagicMock(
        side_effect=RuntimeError(
            "Inference authentication failed (401 Unauthorized): check HF_TOKEN/HF_API_TOKEN."
        )
    )
    mock_post = MagicMock(return_value={"status": "done"})
    mock_log_exception = MagicMock()
    mock_log_error = MagicMock()

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr("app.tasks.extract_frames_as_base64", mock_extract)
    monkeypatch.setattr("app.tasks.run_inference", mock_inference)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)
    monkeypatch.setattr(tasks.logger, "exception", mock_log_exception)
    monkeypatch.setattr(tasks.logger, "error", mock_log_error)

    payload = {
        "event_id": "evt_401",
        "session_id": "sess_401",
        "clip_blob_name": "test.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "error"
    mock_log_exception.assert_not_called()
    mock_log_error.assert_called()


def test_process_clip_without_analysis_prompt(monkeypatch):
    """Test process_clip works without analysis_prompt."""
    mock_download = MagicMock(return_value=b"video data")
    mock_extract = MagicMock(return_value=["data:image/jpeg;base64,frame1"])
    mock_inference = MagicMock(return_value=InferenceResult(
        label="motion",
        summary="Motion detected",
        confidence=0.75,
        provider="huggingface",
        model="zai-org/GLM-4.6V-FP8:zai-org",
        should_notify=False,
        alert_reason="No user alert criteria matched",
        matched_rules=[],
        detected_entities=["motion"],
        detected_actions=["movement"],
    ))
    mock_post = MagicMock(return_value={"status": "done"})
    mock_notify = MagicMock(return_value={"telegram_sent": False, "webhook_sent": False})

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr("app.tasks.extract_frames_as_base64", mock_extract)
    monkeypatch.setattr("app.tasks.run_inference", mock_inference)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)
    monkeypatch.setattr(tasks, "send_outbound_notifications", mock_notify)

    payload = {
        "event_id": "evt_789",
        "session_id": "sess_789",
        "clip_blob_name": "test.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "done"
    # Verify inference was called without user_prompt
    assert mock_inference.call_args[1]["user_prompt"] is None
    mock_post.assert_called_once_with(
        event_id="evt_789",
        summary="Motion detected",
        label="motion",
        confidence=0.75,
        inference_provider="huggingface",
        inference_model="zai-org/GLM-4.6V-FP8:zai-org",
        should_notify=False,
        alert_reason="No user alert criteria matched",
        matched_rules=[],
        detected_entities=["motion"],
        detected_actions=["movement"],
    )
    mock_notify.assert_not_called()


def test_process_clip_saves_inference_frames(monkeypatch):
    """Persist extracted frame images for later reference."""
    mock_download = MagicMock(return_value=b"video data")
    mock_extract = MagicMock(return_value=["data:image/jpeg;base64,Zm9v"])
    mock_save_frames = MagicMock(return_value=[])
    mock_inference = MagicMock(return_value=InferenceResult(
        label="person",
        summary="Detected person",
        confidence=0.91,
        provider="nvidia",
        model="nvidia/nemotron-nano-12b-v2-vl",
        should_notify=True,
        alert_reason="Matched person rule",
        matched_rules=["person rule"],
        detected_entities=["person"],
        detected_actions=["standing"],
    ))
    mock_post = MagicMock(return_value={"status": "done"})

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr("app.tasks.extract_frames_as_base64", mock_extract)
    monkeypatch.setattr("app.tasks.save_frame_data_uris", mock_save_frames)
    monkeypatch.setattr("app.tasks.run_inference", mock_inference)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)

    payload = {
        "event_id": "evt_save",
        "session_id": "sess_save",
        "clip_blob_name": "test.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "done"
    mock_save_frames.assert_called_once_with(
        ["data:image/jpeg;base64,Zm9v"],
        event_id="evt_save",
        session_id="sess_save",
    )


def test_process_clip_test_mode_skips_pipeline(monkeypatch):
    """Test that test mode bypasses clip decoding/inference."""
    monkeypatch.setenv("PING_WATCH_TEST_MODE", "true")

    mock_download = MagicMock()
    mock_extract = MagicMock()
    mock_inference = MagicMock()
    mock_post = MagicMock(return_value={"status": "done"})

    monkeypatch.setattr(tasks, "download_clip_data", mock_download)
    monkeypatch.setattr("app.tasks.extract_frames_as_base64", mock_extract)
    monkeypatch.setattr("app.tasks.run_inference", mock_inference)
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)

    payload = {
        "event_id": "evt_test_mode",
        "session_id": "sess_test_mode",
        "clip_blob_name": "sessions/sess/events/evt.webm",
        "clip_container": "clips",
        "clip_mime": "video/webm",
    }

    result = tasks.process_clip(payload)

    assert result["status"] == "done"
    assert result["event_id"] == "evt_test_mode"
    assert result["label"] == "test"
    assert result["confidence"] == 1.0
    assert "Critical flow test summary for event evt_test_mode" in result["summary"]

    mock_download.assert_not_called()
    mock_extract.assert_not_called()
    mock_inference.assert_not_called()
    mock_post.assert_called_once_with(
        event_id="evt_test_mode",
        summary="Critical flow test summary for event evt_test_mode",
        label="test",
        confidence=1.0,
        inference_provider="test-mode",
        inference_model="test",
        should_notify=True,
        alert_reason="Test mode always notifies",
        matched_rules=["test-mode"],
        detected_entities=["test"],
        detected_actions=["simulated"],
    )

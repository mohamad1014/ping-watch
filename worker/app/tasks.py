"""Worker tasks for processing clips."""

import logging
import os
from typing import Any

import httpx

from app.blob_client import download_clip, download_local_clip
from app.frames import extract_frames_as_base64, save_frame_data_uris
from app.inference import InferenceResult, run_inference
from app.notifications import NotificationPayload, send_outbound_notifications

logger = logging.getLogger(__name__)


def _api_base_url() -> str:
    return os.environ.get("API_BASE_URL", "http://localhost:8000")


def _is_test_mode() -> bool:
    return os.environ.get("PING_WATCH_TEST_MODE", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


def post_event_summary(
    event_id: str,
    summary: str,
    label: str | None,
    confidence: float | None,
    inference_provider: str | None = None,
    inference_model: str | None = None,
    should_notify: bool | None = None,
    alert_reason: str | None = None,
    matched_rules: list[str] | None = None,
    detected_entities: list[str] | None = None,
    detected_actions: list[str] | None = None,
) -> dict[str, Any]:
    """Post inference results to the backend API."""
    payload = {
        "summary": summary,
        "label": label,
        "confidence": confidence,
        "inference_provider": inference_provider,
        "inference_model": inference_model,
        "should_notify": should_notify,
        "alert_reason": alert_reason,
        "matched_rules": matched_rules,
        "detected_entities": detected_entities,
        "detected_actions": detected_actions,
    }
    logger.info(
        "Posting summary for event %s: label=%s, confidence=%s, provider=%s, model=%s, notify=%s",
        event_id,
        label,
        confidence,
        inference_provider,
        inference_model,
        should_notify,
    )

    response = httpx.post(
        f"{_api_base_url()}/events/{event_id}/summary",
        json=payload,
        timeout=10,
    )
    response.raise_for_status()
    return response.json()


def download_clip_data(
    clip_blob_name: str,
    clip_container: str,
) -> bytes:
    """Download clip data from blob storage or local storage.

    Attempts blob storage first, falls back to local storage.
    """
    # Check if this is a local upload
    if clip_container == "local" or not clip_blob_name:
        logger.info(f"Downloading from local storage: {clip_blob_name}")
        return download_local_clip(clip_blob_name)

    # Try blob storage
    try:
        return download_clip(clip_blob_name, clip_container)
    except RuntimeError as exc:
        # Fall back to local storage if blob fails
        logger.warning(
            "Blob download failed for %s from %s; trying local storage fallback: %s",
            clip_blob_name,
            clip_container,
            exc,
        )
        return download_local_clip(clip_blob_name)


def process_clip(payload: dict[str, Any]) -> dict[str, Any]:
    """Process a clip through the inference pipeline.

    Pipeline steps:
    1. Download clip from blob storage
    2. Extract frames from video
    3. Run VLM inference on frames
    4. Post results to backend API

    Args:
        payload: Job payload containing:
            - event_id: ID of the event
            - session_id: ID of the session
            - clip_blob_name: Blob name/path for the clip
            - clip_container: Container name
            - analysis_prompt: Optional user-defined prompt

    Returns:
        Dictionary with processing result
    """
    event_id = payload.get("event_id")
    session_id = payload.get("session_id")
    device_id = payload.get("device_id")
    clip_blob_name = payload.get("clip_blob_name", "")
    clip_container = payload.get("clip_container", "")
    clip_mime = payload.get("clip_mime", "video/webm")
    analysis_prompt = payload.get("analysis_prompt")

    logger.info(f"Processing clip for event {event_id} (session {session_id})")

    if not event_id:
        logger.error("Missing event_id in payload")
        return {"status": "error", "error": "missing event_id"}

    try:
        if _is_test_mode():
            summary = f"Critical flow test summary for event {event_id}"
            post_event_summary(
                event_id=event_id,
                summary=summary,
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
            return {
                "status": "done",
                "event_id": event_id,
                "label": "test",
                "summary": summary,
                "confidence": 1.0,
                "inference_provider": "test-mode",
                "inference_model": "test",
                "should_notify": True,
                "alert_reason": "Test mode always notifies",
                "matched_rules": ["test-mode"],
                "detected_entities": ["test"],
                "detected_actions": ["simulated"],
            }

        # Step 1: Download clip
        logger.info(f"Downloading clip: {clip_blob_name} from {clip_container}")
        clip_data = download_clip_data(clip_blob_name, clip_container)
        logger.info(f"Downloaded {len(clip_data)} bytes")

        # Step 2: Extract frames (best effort, used for persistence + HF fallback)
        frame_data_uris: list[str] = []
        try:
            logger.info("Extracting frames from clip")
            num_frames = int(os.environ.get("INFERENCE_NUM_FRAMES", "3"))
            frame_data_uris = extract_frames_as_base64(
                clip_data,
                num_frames=num_frames,
                output_format="jpeg",
                quality=85,
            )
            logger.info("Extracted %s frame(s)", len(frame_data_uris))
            try:
                save_frame_data_uris(
                    frame_data_uris,
                    event_id=event_id,
                    session_id=session_id,
                )
            except Exception as exc:
                logger.warning(
                    "Failed to persist inference frames for event %s: %s",
                    event_id,
                    exc,
                )
        except Exception as exc:
            logger.warning(
                "Frame extraction failed for event %s; continuing with raw video inference: %s",
                event_id,
                exc,
            )

        # Step 3: Run inference
        logger.info("Running VLM inference")
        result: InferenceResult = run_inference(
            clip_data=clip_data,
            clip_mime=clip_mime,
            user_prompt=analysis_prompt,
            frame_data_uris=frame_data_uris,
        )
        logger.info(
            "Inference result: label=%s, confidence=%s, provider=%s, model=%s, notify=%s",
            result.label,
            result.confidence,
            result.provider,
            result.model,
            result.should_notify,
        )

        # Step 4: Post results to backend
        api_response = post_event_summary(
            event_id=event_id,
            summary=result.summary,
            label=result.label,
            confidence=result.confidence,
            inference_provider=result.provider,
            inference_model=result.model,
            should_notify=result.should_notify,
            alert_reason=result.alert_reason,
            matched_rules=result.matched_rules,
            detected_entities=result.detected_entities,
            detected_actions=result.detected_actions,
        )

        notification_delivery = {"telegram_sent": False, "webhook_sent": False}
        if result.should_notify:
            logger.info("Dispatching outbound notifications for event %s", event_id)
            try:
                notification_delivery = send_outbound_notifications(
                    NotificationPayload(
                        event_id=event_id,
                        session_id=session_id or "",
                        device_id=device_id,
                        summary=result.summary,
                        label=result.label,
                        confidence=result.confidence,
                        alert_reason=result.alert_reason,
                        inference_provider=result.provider,
                        inference_model=result.model,
                        clip_uri=api_response.get("clip_uri") if isinstance(api_response, dict) else None,
                        clip_mime=clip_mime,
                        clip_data=clip_data,
                        should_notify=True,
                        matched_rules=result.matched_rules,
                        detected_entities=result.detected_entities,
                        detected_actions=result.detected_actions,
                    )
                )
            except Exception as exc:
                logger.warning(
                    "Notification dispatch crashed for event %s: %s",
                    event_id,
                    exc,
                )
            logger.info(
                "Notification delivery for event %s: telegram=%s webhook=%s",
                event_id,
                notification_delivery["telegram_sent"],
                notification_delivery["webhook_sent"],
            )
        else:
            logger.info(
                "Notification dispatch skipped for event %s: should_notify=%s",
                event_id,
                result.should_notify,
            )

        return {
            "status": "done",
            "event_id": event_id,
            "label": result.label,
            "summary": result.summary,
            "confidence": result.confidence,
            "inference_provider": result.provider,
            "inference_model": result.model,
            "should_notify": result.should_notify,
            "alert_reason": result.alert_reason,
            "matched_rules": result.matched_rules,
            "detected_entities": result.detected_entities,
            "detected_actions": result.detected_actions,
            "notification_delivery": notification_delivery,
        }

    except Exception as exc:
        is_auth_error = isinstance(exc, RuntimeError) and (
            "Inference authentication failed" in str(exc)
        )
        if is_auth_error:
            logger.error(f"Failed to process clip for event {event_id}: {exc}")
        else:
            logger.exception(f"Failed to process clip for event {event_id}: {exc}")

        # Post a fallback summary indicating failure
        try:
            post_event_summary(
                event_id=event_id,
                summary=f"Processing failed: {str(exc)[:200]}",
                label="error",
                confidence=0.0,
                inference_provider=None,
                inference_model=None,
                should_notify=False,
                alert_reason="Processing failed before alert evaluation",
                matched_rules=[],
                detected_entities=[],
                detected_actions=[],
            )
        except Exception as post_exc:
            logger.error(f"Failed to post error summary: {post_exc}")

        return {
            "status": "error",
            "event_id": event_id,
            "error": str(exc),
        }

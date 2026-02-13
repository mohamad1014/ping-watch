"""Worker tasks for processing clips."""

import logging
import os
from typing import Any

import httpx

from app.blob_client import download_clip, download_local_clip
from app.frames import extract_frames_as_base64
from app.inference import InferenceResult, run_inference

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
) -> dict[str, Any]:
    """Post inference results to the backend API."""
    payload = {
        "summary": summary,
        "label": label,
        "confidence": confidence,
    }
    logger.info(f"Posting summary for event {event_id}: label={label}, confidence={confidence}")

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
    except RuntimeError:
        # Fall back to local storage if blob fails
        logger.warning("Blob download failed, trying local storage")
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
    clip_blob_name = payload.get("clip_blob_name", "")
    clip_container = payload.get("clip_container", "")
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
            )
            return {
                "status": "done",
                "event_id": event_id,
                "label": "test",
                "summary": summary,
                "confidence": 1.0,
            }

        # Step 1: Download clip
        logger.info(f"Downloading clip: {clip_blob_name} from {clip_container}")
        clip_data = download_clip_data(clip_blob_name, clip_container)
        logger.info(f"Downloaded {len(clip_data)} bytes")

        # Step 2: Extract frames
        logger.info("Extracting frames from clip")
        num_frames = int(os.environ.get("INFERENCE_NUM_FRAMES", "3"))
        frame_data_uris = extract_frames_as_base64(
            clip_data,
            num_frames=num_frames,
            output_format="jpeg",
            quality=85,
        )
        logger.info(f"Extracted {len(frame_data_uris)} frames")

        # Step 3: Run inference
        logger.info("Running VLM inference")
        result: InferenceResult = run_inference(
            frame_data_uris=frame_data_uris,
            user_prompt=analysis_prompt,
        )
        logger.info(f"Inference result: label={result.label}, confidence={result.confidence}")

        # Step 4: Post results to backend
        api_response = post_event_summary(
            event_id=event_id,
            summary=result.summary,
            label=result.label,
            confidence=result.confidence,
        )

        return {
            "status": "done",
            "event_id": event_id,
            "label": result.label,
            "summary": result.summary,
            "confidence": result.confidence,
        }

    except Exception as exc:
        logger.exception(f"Failed to process clip for event {event_id}: {exc}")

        # Post a fallback summary indicating failure
        try:
            post_event_summary(
                event_id=event_id,
                summary=f"Processing failed: {str(exc)[:200]}",
                label="error",
                confidence=0.0,
            )
        except Exception as post_exc:
            logger.error(f"Failed to post error summary: {post_exc}")

        return {
            "status": "error",
            "event_id": event_id,
            "error": str(exc),
        }

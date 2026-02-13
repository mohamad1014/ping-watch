"""Frame extraction from video clips."""

import base64
import binascii
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

import cv2

logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _resolve_inference_frames_dir(output_dir: Optional[str] = None) -> Path:
    configured = output_dir or os.environ.get("INFERENCE_FRAMES_DIR")
    if not configured:
        return _repo_root() / ".inference_frames"

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return _repo_root() / path


def _safe_segment(value: str) -> str:
    return value.replace("/", "_").replace("\\", "_").strip() or "unknown"


def _image_extension_for_mime(mime_type: str) -> str:
    normalized = (mime_type or "").lower().strip()
    if normalized == "image/png":
        return ".png"
    return ".jpg"


def save_frame_data_uris(
    frame_data_uris: list[str],
    *,
    event_id: str,
    session_id: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> list[Path]:
    """Persist extracted frame data URIs to disk for later inspection."""
    if not frame_data_uris:
        return []

    root_dir = _resolve_inference_frames_dir(output_dir)
    safe_event_id = _safe_segment(event_id)
    if session_id:
        safe_session_id = _safe_segment(session_id)
        target_dir = root_dir / "sessions" / safe_session_id / "events" / safe_event_id
    else:
        target_dir = root_dir / "events" / safe_event_id

    target_dir.mkdir(parents=True, exist_ok=True)

    saved_paths: list[Path] = []
    for index, data_uri in enumerate(frame_data_uris, start=1):
        if not data_uri.startswith("data:") or ";base64," not in data_uri:
            logger.warning("Skipping malformed frame data URI for event %s", event_id)
            continue

        header, encoded = data_uri.split(",", 1)
        mime_type = header[5:].split(";", 1)[0]
        extension = _image_extension_for_mime(mime_type)

        try:
            image_bytes = base64.b64decode(encoded, validate=True)
        except (binascii.Error, ValueError):
            logger.warning("Skipping undecodable frame data URI for event %s", event_id)
            continue

        frame_path = target_dir / f"frame_{index:02d}{extension}"
        frame_path.write_bytes(image_bytes)
        saved_paths.append(frame_path)

    if saved_paths:
        logger.info(
            "Saved %s inference frame(s) for event %s to %s",
            len(saved_paths),
            event_id,
            target_dir,
        )
    return saved_paths


def _calculate_positions(total_frames: int, num_frames: int) -> list[int]:
    if total_frames <= 0:
        return []
    if num_frames <= 1:
        return [total_frames // 2]

    step = total_frames / (num_frames + 1)
    return [int(step * (i + 1)) for i in range(num_frames)]


def _encode_frame(frame, output_format: str, quality: int) -> bytes | None:
    if output_format.lower() == "png":
        success, buffer = cv2.imencode(".png", frame)
    else:
        encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
        success, buffer = cv2.imencode(".jpg", frame, encode_params)

    if not success:
        return None
    return buffer.tobytes()


def extract_frames_from_bytes(
    video_bytes: bytes,
    num_frames: int = 3,
    output_format: str = "jpeg",
    quality: int = 85,
) -> list[bytes]:
    """Extract key frames from video bytes.

    Args:
        video_bytes: Raw video data
        num_frames: Number of frames to extract (evenly distributed)
        output_format: Image format for output frames (jpeg or png)
        quality: JPEG quality (1-100)

    Returns:
        List of frame images as bytes
    """
    # Write video to temp file (OpenCV needs a file path)
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = Path(tmp.name)

    try:
        return extract_frames_from_file(tmp_path, num_frames, output_format, quality)
    finally:
        tmp_path.unlink(missing_ok=True)


def extract_frames_from_file(
    video_path: Path,
    num_frames: int = 3,
    output_format: str = "jpeg",
    quality: int = 85,
) -> list[bytes]:
    """Extract key frames from a video file.

    Args:
        video_path: Path to the video file
        num_frames: Number of frames to extract (evenly distributed)
        output_format: Image format for output frames (jpeg or png)
        quality: JPEG quality (1-100)

    Returns:
        List of frame images as bytes
    """
    logger.info(f"Extracting {num_frames} frames from {video_path}")

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    try:
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        frames = []

        if total_frames <= 0:
            logger.warning(
                "Invalid frame count (%s); falling back to sequential scan for %s",
                total_frames,
                video_path,
            )
            scan_count = 0
            while True:
                ret, _ = cap.read()
                if not ret:
                    break
                scan_count += 1

            if scan_count <= 0:
                raise RuntimeError(f"Video has no frames: {video_path}")

            positions = _calculate_positions(scan_count, num_frames)
            logger.info(
                "Scanned %s frames; extracting at positions: %s",
                scan_count,
                positions,
            )

            cap.release()
            cap = cv2.VideoCapture(str(video_path))
            if not cap.isOpened():
                raise RuntimeError(f"Failed to reopen video: {video_path}")

            position_set = set(positions)
            frame_index = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                if frame_index in position_set:
                    encoded = _encode_frame(frame, output_format, quality)
                    if encoded is not None:
                        frames.append(encoded)
                frame_index += 1
        else:
            positions = _calculate_positions(total_frames, num_frames)
            logger.info(f"Total frames: {total_frames}, extracting at positions: {positions}")

            for pos in positions:
                cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
                ret, frame = cap.read()
                if not ret:
                    logger.warning(f"Failed to read frame at position {pos}")
                    continue

                encoded = _encode_frame(frame, output_format, quality)
                if encoded is not None:
                    frames.append(encoded)
                else:
                    logger.warning(f"Failed to encode frame at position {pos}")

        logger.info(f"Extracted {len(frames)} frames")
        if len(frames) == 0:
            raise RuntimeError(f"Failed to decode frames from video: {video_path}")
        return frames

    finally:
        cap.release()


def frames_to_base64(
    frames: list[bytes],
    mime_type: str = "image/jpeg",
) -> list[str]:
    """Convert frame bytes to base64 data URIs.

    Args:
        frames: List of frame images as bytes
        mime_type: MIME type for the data URI

    Returns:
        List of base64 data URIs
    """
    data_uris = []
    for frame in frames:
        b64 = base64.b64encode(frame).decode("utf-8")
        data_uri = f"data:{mime_type};base64,{b64}"
        data_uris.append(data_uri)
    return data_uris


def extract_frames_as_base64(
    video_bytes: bytes,
    num_frames: int = 3,
    output_format: str = "jpeg",
    quality: int = 85,
) -> list[str]:
    """Extract frames from video and return as base64 data URIs.

    Args:
        video_bytes: Raw video data
        num_frames: Number of frames to extract
        output_format: Image format (jpeg or png)
        quality: JPEG quality (1-100)

    Returns:
        List of base64 data URIs
    """
    frames = extract_frames_from_bytes(video_bytes, num_frames, output_format, quality)
    mime_type = "image/png" if output_format.lower() == "png" else "image/jpeg"
    return frames_to_base64(frames, mime_type)

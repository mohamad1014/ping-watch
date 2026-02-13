"""Frame extraction from video clips."""

import base64
import logging
import tempfile
from pathlib import Path
from typing import Optional

import cv2

logger = logging.getLogger(__name__)


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
        if total_frames <= 0:
            raise RuntimeError(f"Video has no frames: {video_path}")

        # Calculate frame positions (evenly distributed)
        if num_frames == 1:
            # For single frame, use middle of video
            positions = [total_frames // 2]
        else:
            # Evenly distribute frames, avoiding very first and last
            step = total_frames / (num_frames + 1)
            positions = [int(step * (i + 1)) for i in range(num_frames)]

        logger.info(f"Total frames: {total_frames}, extracting at positions: {positions}")

        frames = []
        for pos in positions:
            cap.set(cv2.CAP_PROP_POS_FRAMES, pos)
            ret, frame = cap.read()
            if not ret:
                logger.warning(f"Failed to read frame at position {pos}")
                continue

            # Encode frame to bytes
            if output_format.lower() == "png":
                success, buffer = cv2.imencode(".png", frame)
            else:
                encode_params = [cv2.IMWRITE_JPEG_QUALITY, quality]
                success, buffer = cv2.imencode(".jpg", frame, encode_params)

            if success:
                frames.append(buffer.tobytes())
            else:
                logger.warning(f"Failed to encode frame at position {pos}")

        logger.info(f"Extracted {len(frames)} frames")
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

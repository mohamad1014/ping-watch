"""Tests for frame extraction module."""

import base64
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app import frames


def test_frames_to_base64():
    """Test converting frame bytes to base64 data URIs."""
    test_frames = [b"frame1", b"frame2"]

    result = frames.frames_to_base64(test_frames, mime_type="image/jpeg")

    assert len(result) == 2
    assert result[0].startswith("data:image/jpeg;base64,")
    assert result[1].startswith("data:image/jpeg;base64,")

    # Verify the base64 decodes correctly
    b64_part = result[0].replace("data:image/jpeg;base64,", "")
    decoded = base64.b64decode(b64_part)
    assert decoded == b"frame1"


def test_frames_to_base64_png():
    """Test converting frames with PNG mime type."""
    test_frames = [b"pngdata"]

    result = frames.frames_to_base64(test_frames, mime_type="image/png")

    assert result[0].startswith("data:image/png;base64,")


def test_extract_frames_from_bytes_creates_temp_file(monkeypatch):
    """Test that extract_frames_from_bytes creates a temp file and calls extract_frames_from_file."""
    mock_extract = MagicMock(return_value=[b"frame"])
    monkeypatch.setattr(frames, "extract_frames_from_file", mock_extract)

    result = frames.extract_frames_from_bytes(b"video data", num_frames=1)

    assert result == [b"frame"]
    mock_extract.assert_called_once()
    # Verify it was called with a Path
    call_args = mock_extract.call_args[0]
    assert isinstance(call_args[0], Path)


def test_extract_frames_as_base64(monkeypatch):
    """Test the combined extract and base64 encode function."""
    mock_extract = MagicMock(return_value=[b"frame1", b"frame2"])
    monkeypatch.setattr(frames, "extract_frames_from_bytes", mock_extract)

    result = frames.extract_frames_as_base64(
        b"video data",
        num_frames=2,
        output_format="jpeg",
    )

    assert len(result) == 2
    assert all(uri.startswith("data:image/jpeg;base64,") for uri in result)


def test_extract_frames_as_base64_png_format(monkeypatch):
    """Test extract_frames_as_base64 with PNG format."""
    mock_extract = MagicMock(return_value=[b"frame"])
    monkeypatch.setattr(frames, "extract_frames_from_bytes", mock_extract)

    result = frames.extract_frames_as_base64(
        b"video data",
        num_frames=1,
        output_format="png",
    )

    assert result[0].startswith("data:image/png;base64,")


def test_extract_frames_from_file_handles_invalid_frame_count(monkeypatch, tmp_path):
    """Falls back to sequential scan when CAP_PROP_FRAME_COUNT is invalid."""
    import numpy as np

    class FakeCapture:
        def __init__(self, path: str):
            self.path = path
            self.frame_idx = 0
            self.released = False
            self.total = 6

        def isOpened(self) -> bool:
            return True

        def get(self, prop: int) -> float:
            if prop == frames.cv2.CAP_PROP_FRAME_COUNT:
                return -1.0
            return 0.0

        def set(self, prop: int, value: float) -> bool:
            # Not used by unknown-frame fallback path.
            return True

        def read(self):
            if self.frame_idx >= self.total:
                return False, None
            frame = np.zeros((8, 8, 3), dtype=np.uint8)
            frame[:, :, 0] = self.frame_idx
            self.frame_idx += 1
            return True, frame

        def release(self) -> None:
            self.released = True

    monkeypatch.setattr(frames.cv2, "VideoCapture", lambda _: FakeCapture("unused"))

    output_path = tmp_path / "input.webm"
    output_path.write_bytes(b"placeholder")

    result = frames.extract_frames_from_file(output_path, num_frames=3, output_format="jpeg")
    assert len(result) == 3
    assert all(isinstance(item, bytes) and len(item) > 0 for item in result)


def test_save_frame_data_uris_persists_images(tmp_path):
    """Persist decoded frame images to an event-specific directory."""
    data_uris = [
        "data:image/jpeg;base64," + base64.b64encode(b"jpeg-frame").decode("utf-8"),
        "data:image/png;base64," + base64.b64encode(b"png-frame").decode("utf-8"),
    ]

    saved = frames.save_frame_data_uris(
        data_uris,
        event_id="evt_1",
        session_id="sess_1",
        output_dir=str(tmp_path),
    )

    assert len(saved) == 2
    assert saved[0].name == "frame_01.jpg"
    assert saved[1].name == "frame_02.png"
    assert saved[0].read_bytes() == b"jpeg-frame"
    assert saved[1].read_bytes() == b"png-frame"
    assert saved[0].parent == tmp_path / "sessions" / "sess_1" / "events" / "evt_1"


def test_save_frame_data_uris_skips_invalid_entries(tmp_path):
    """Ignore malformed frame URIs instead of raising."""
    saved = frames.save_frame_data_uris(
        ["bad-entry", "data:image/jpeg;base64,not-valid-base64"],
        event_id="evt_2",
        output_dir=str(tmp_path),
    )
    assert saved == []


# Integration test with actual OpenCV (skipped if cv2 not available)
@pytest.mark.skipif(
    not pytest.importorskip("cv2", reason="OpenCV not installed"),
    reason="OpenCV required for integration test",
)
def test_extract_frames_from_file_with_real_video():
    """Integration test with a real video file.

    This test is skipped if OpenCV is not available or if creating
    a test video fails.
    """
    import cv2
    import numpy as np

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = Path(tmpdir) / "test.mp4"

        # Create a minimal test video
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        out = cv2.VideoWriter(str(video_path), fourcc, 10.0, (64, 64))

        # Write 30 frames (3 seconds at 10fps)
        for i in range(30):
            frame = np.zeros((64, 64, 3), dtype=np.uint8)
            frame[:, :, 0] = i * 8  # Varying blue channel
            out.write(frame)
        out.release()

        if not video_path.exists():
            pytest.skip("Failed to create test video")

        # Extract frames
        result = frames.extract_frames_from_file(video_path, num_frames=3)

        assert len(result) == 3
        assert all(isinstance(f, bytes) for f in result)
        assert all(len(f) > 0 for f in result)

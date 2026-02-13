"""Tests for blob client module."""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app import blob_client


def test_load_blob_config_from_env(monkeypatch):
    """Test loading blob configuration from environment variables."""
    monkeypatch.setenv("AZURITE_BLOB_ENDPOINT", "http://localhost:10000/test")
    monkeypatch.setenv("AZURITE_ACCOUNT_NAME", "testaccount")
    monkeypatch.setenv("AZURITE_ACCOUNT_KEY", "testkey123")
    monkeypatch.setenv("AZURITE_CLIPS_CONTAINER", "testcontainer")

    config = blob_client.load_blob_config()

    assert config.endpoint == "http://localhost:10000/test"
    assert config.account_name == "testaccount"
    assert config.account_key == "testkey123"
    assert config.container == "testcontainer"


def test_load_blob_config_missing_vars(monkeypatch):
    """Test that missing environment variables raise RuntimeError."""
    monkeypatch.delenv("AZURITE_BLOB_ENDPOINT", raising=False)
    monkeypatch.delenv("AZURITE_ACCOUNT_NAME", raising=False)
    monkeypatch.delenv("AZURITE_ACCOUNT_KEY", raising=False)

    with pytest.raises(RuntimeError, match="Missing required blob storage"):
        blob_client.load_blob_config()


def test_download_local_clip_success():
    """Test downloading a clip from local storage."""
    with tempfile.TemporaryDirectory() as tmpdir:
        clip_path = Path(tmpdir) / "sessions" / "sess_1" / "events" / "evt_1.webm"
        clip_path.parent.mkdir(parents=True)
        clip_path.write_bytes(b"fake video data")

        result = blob_client.download_local_clip(
            "sessions/sess_1/events/evt_1.webm",
            local_upload_dir=tmpdir,
        )

        assert result == b"fake video data"


def test_download_local_clip_not_found():
    """Test that missing local clip raises RuntimeError."""
    with tempfile.TemporaryDirectory() as tmpdir:
        with pytest.raises(RuntimeError, match="Local clip not found"):
            blob_client.download_local_clip("nonexistent.webm", local_upload_dir=tmpdir)


def test_download_clip_calls_blob_service(monkeypatch):
    """Test that download_clip calls the blob service client."""
    mock_config = blob_client.BlobConfig(
        endpoint="http://localhost:10000/test",
        account_name="testaccount",
        account_key="testkey",
        container="clips",
    )

    mock_blob_data = b"video bytes"
    mock_download = MagicMock()
    mock_download.readall.return_value = mock_blob_data

    mock_blob_client = MagicMock()
    mock_blob_client.download_blob.return_value = mock_download

    mock_service = MagicMock()
    mock_service.get_blob_client.return_value = mock_blob_client

    with patch.object(blob_client, "get_blob_service_client", return_value=mock_service):
        result = blob_client.download_clip(
            "sessions/sess_1/events/evt_1.webm",
            container="clips",
            config=mock_config,
        )

    assert result == mock_blob_data
    mock_service.get_blob_client.assert_called_once_with(
        container="clips",
        blob="sessions/sess_1/events/evt_1.webm",
    )

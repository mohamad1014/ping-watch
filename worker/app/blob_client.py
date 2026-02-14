"""Azure Blob Storage client for downloading clips."""

import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from azure.storage.blob import BlobServiceClient
from azure.core.exceptions import HttpResponseError, ResourceNotFoundError

logger = logging.getLogger(__name__)
DEFAULT_AZURITE_BLOB_API_VERSION = "2021-12-02"


@dataclass(frozen=True)
class BlobConfig:
    endpoint: str
    account_name: str
    account_key: str
    container: str


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _resolve_local_upload_dir(local_upload_dir: Optional[str]) -> Path:
    configured = local_upload_dir or os.environ.get("LOCAL_UPLOAD_DIR")
    if not configured:
        return _repo_root() / ".local_uploads"

    path = Path(configured).expanduser()
    if path.is_absolute():
        return path
    return _repo_root() / path


def load_blob_config() -> BlobConfig:
    """Load blob storage configuration from environment variables."""
    endpoint = os.environ.get("AZURITE_BLOB_ENDPOINT")
    account_name = os.environ.get("AZURITE_ACCOUNT_NAME")
    account_key = os.environ.get("AZURITE_ACCOUNT_KEY")
    container = os.environ.get("AZURITE_CLIPS_CONTAINER", "clips")

    if not all([endpoint, account_name, account_key]):
        raise RuntimeError(
            "Missing required blob storage environment variables: "
            "AZURITE_BLOB_ENDPOINT, AZURITE_ACCOUNT_NAME, AZURITE_ACCOUNT_KEY"
        )

    return BlobConfig(
        endpoint=endpoint,
        account_name=account_name,
        account_key=account_key,
        container=container,
    )


def get_blob_service_client(config: Optional[BlobConfig] = None) -> BlobServiceClient:
    """Create a BlobServiceClient from configuration."""
    config = config or load_blob_config()
    api_version = os.environ.get("AZURITE_BLOB_API_VERSION", DEFAULT_AZURITE_BLOB_API_VERSION)
    connection_string = (
        f"DefaultEndpointsProtocol=http;"
        f"AccountName={config.account_name};"
        f"AccountKey={config.account_key};"
        f"BlobEndpoint={config.endpoint};"
    )
    return BlobServiceClient.from_connection_string(
        connection_string,
        api_version=api_version,
    )


def download_clip(
    blob_name: str,
    container: Optional[str] = None,
    config: Optional[BlobConfig] = None,
) -> bytes:
    """Download a clip from blob storage.

    Args:
        blob_name: The name/path of the blob to download
        container: Container name (defaults to config.container)
        config: Blob configuration (loads from env if not provided)

    Returns:
        The clip data as bytes

    Raises:
        RuntimeError: If download fails
    """
    config = config or load_blob_config()
    container = container or config.container

    logger.info(f"Downloading blob {blob_name} from container {container}")

    try:
        client = get_blob_service_client(config)
        blob_client = client.get_blob_client(container=container, blob=blob_name)
        data = blob_client.download_blob().readall()
        logger.info(f"Downloaded {len(data)} bytes from {blob_name}")
        return data
    except ResourceNotFoundError as exc:
        logger.warning(
            "Blob not found in storage: container=%s blob=%s",
            container,
            blob_name,
        )
        raise RuntimeError("Blob not found in storage") from exc
    except HttpResponseError as exc:
        status = getattr(exc, "status_code", None)
        logger.error(
            "Blob download HTTP error: container=%s blob=%s status=%s",
            container,
            blob_name,
            status,
        )
        raise RuntimeError(f"Blob download HTTP error: status={status}") from exc
    except Exception as exc:
        logger.error(
            "Failed to download blob %s from container %s: %s",
            blob_name,
            container,
            exc,
        )
        raise RuntimeError(f"Failed to download clip: {exc}") from exc


def download_clip_to_file(
    blob_name: str,
    output_path: Path,
    container: Optional[str] = None,
    config: Optional[BlobConfig] = None,
) -> Path:
    """Download a clip to a local file.

    Args:
        blob_name: The name/path of the blob to download
        output_path: Local path to save the file
        container: Container name (defaults to config.container)
        config: Blob configuration (loads from env if not provided)

    Returns:
        The path to the downloaded file
    """
    data = download_clip(blob_name, container, config)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(data)
    logger.info(f"Saved clip to {output_path}")
    return output_path


def download_local_clip(blob_name: str, local_upload_dir: Optional[str] = None) -> bytes:
    """Download a clip from local storage (for development without Azurite).

    Args:
        blob_name: The name/path of the blob
        local_upload_dir: Directory where local uploads are stored

    Returns:
        The clip data as bytes
    """
    local_dir = _resolve_local_upload_dir(local_upload_dir)
    file_path = local_dir / blob_name

    if not file_path.exists():
        raise RuntimeError(f"Local clip not found: {file_path}")

    logger.info(f"Reading local clip from {file_path}")
    return file_path.read_bytes()

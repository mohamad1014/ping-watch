import base64
import hashlib
import hmac
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from urllib.parse import urlencode, urlparse


@dataclass(frozen=True)
class AzuriteConfig:
    endpoint: str
    account_name: str
    account_key: str
    container: str
    sas_expiry_seconds: int
    sas_version: str
    sas_protocol: str
    auto_create_container: bool
    request_timeout_seconds: float


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _format_sas_dt(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_config() -> AzuriteConfig:
    endpoint = os.environ.get("AZURITE_BLOB_ENDPOINT")
    account_name = os.environ.get("AZURITE_ACCOUNT_NAME")
    account_key = os.environ.get("AZURITE_ACCOUNT_KEY")
    if not endpoint or not account_name or not account_key:
        raise RuntimeError(
            "Azurite config missing: set AZURITE_BLOB_ENDPOINT, AZURITE_ACCOUNT_NAME, AZURITE_ACCOUNT_KEY"
        )
    return AzuriteConfig(
        endpoint=endpoint.rstrip("/"),
        account_name=account_name,
        account_key=account_key,
        container=os.environ.get("AZURITE_CLIPS_CONTAINER", "clips"),
        sas_expiry_seconds=int(os.environ.get("AZURITE_SAS_EXPIRY_SECONDS", "900")),
        sas_version=os.environ.get("AZURITE_SAS_VERSION", "2020-10-02"),
        sas_protocol=os.environ.get("AZURITE_SAS_PROTOCOL", "http"),
        auto_create_container=os.environ.get("AZURITE_AUTO_CREATE_CONTAINER", "false")
        .strip()
        .lower()
        in ("1", "true", "yes"),
        request_timeout_seconds=float(
            os.environ.get("AZURITE_REQUEST_TIMEOUT_SECONDS", "2.0")
        ),
    )


def guess_extension(mime_type: str) -> str:
    normalized = (mime_type or "").lower().split(";")[0].strip()
    if normalized == "video/webm":
        return ".webm"
    if normalized == "video/mp4":
        return ".mp4"
    return ""


def build_blob_name(session_id: str, event_id: str, mime_type: str) -> str:
    ext = guess_extension(mime_type)
    return f"sessions/{session_id}/events/{event_id}{ext}"


def build_blob_url(config: AzuriteConfig, blob_name: str) -> str:
    return f"{config.endpoint}/{config.container}/{blob_name}"


def generate_blob_upload_sas(
    *,
    config: AzuriteConfig,
    blob_name: str,
    now: datetime | None = None,
) -> tuple[str, datetime]:
    current = now or _utc_now()
    expiry = current + timedelta(seconds=config.sas_expiry_seconds)
    permissions = "cw"
    resource = "b"
    canonicalized_resource = (
        f"/blob/{config.account_name}/{config.container}/{blob_name}"
    )

    string_to_sign = "\n".join(
        [
            permissions,
            "",  # signed start
            _format_sas_dt(expiry),  # signed expiry
            canonicalized_resource,
            "",  # signed identifier
            "",  # signed IP
            config.sas_protocol,  # signed protocol
            config.sas_version,  # signed version
            resource,  # signed resource
            "",  # signed snapshot time
            "",  # signed encryption scope
            "",  # rscc
            "",  # rscd
            "",  # rsce
            "",  # rscl
            "",  # rsct
        ]
    )

    decoded_key = base64.b64decode(config.account_key)
    signature = base64.b64encode(
        hmac.new(decoded_key, string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode("utf-8")

    query = {
        "sv": config.sas_version,
        "se": _format_sas_dt(expiry),
        "sp": permissions,
        "sr": resource,
        "spr": config.sas_protocol,
        "sig": signature,
    }
    return urlencode(query), expiry


def _build_shared_key_authorization(
    *,
    config: AzuriteConfig,
    method: str,
    content_length: int,
    canonicalized_resource: str,
    x_ms_date: str,
    x_ms_version: str,
) -> str:
    string_to_sign = _build_shared_key_string_to_sign(
        config=config,
        method=method,
        content_length=content_length,
        canonicalized_resource=canonicalized_resource,
        x_ms_date=x_ms_date,
        x_ms_version=x_ms_version,
    )
    decoded_key = base64.b64decode(config.account_key)
    signature = base64.b64encode(
        hmac.new(decoded_key, string_to_sign.encode("utf-8"), hashlib.sha256).digest()
    ).decode("utf-8")
    return f"SharedKey {config.account_name}:{signature}"


def _build_shared_key_string_to_sign(
    *,
    config: AzuriteConfig,
    method: str,
    content_length: int,
    canonicalized_resource: str,
    x_ms_date: str,
    x_ms_version: str,
) -> str:
    canonicalized_headers = "\n".join(
        [
            f"x-ms-date:{x_ms_date}",
            f"x-ms-version:{x_ms_version}",
            "",
        ]
    )
    # Azure Blob Shared Key expects an empty Content-Length line when the value is 0.
    content_length_value = "" if content_length == 0 else str(content_length)
    string_to_sign = "\n".join(
        [
            method.upper(),
            "",  # Content-Encoding
            "",  # Content-Language
            content_length_value,
            "",  # Content-MD5
            "",  # Content-Type
            "",  # Date (use x-ms-date)
            "",  # If-Modified-Since
            "",  # If-Match
            "",  # If-None-Match
            "",  # If-Unmodified-Since
            "",  # Range
            canonicalized_headers + canonicalized_resource,
        ]
    )
    return string_to_sign


def ensure_container_exists(config: AzuriteConfig) -> None:
    x_ms_version = config.sas_version
    x_ms_date = _format_sas_dt(_utc_now())
    container_url = f"{config.endpoint}/{config.container}?restype=container"
    endpoint_path = urlparse(config.endpoint).path.strip("/")
    resource_path = "/".join(
        part for part in (endpoint_path, config.container) if part
    )
    canonicalized_resource = f"/{config.account_name}/{resource_path}\nrestype:container"
    authorization = _build_shared_key_authorization(
        config=config,
        method="PUT",
        content_length=0,
        canonicalized_resource=canonicalized_resource,
        x_ms_date=x_ms_date,
        x_ms_version=x_ms_version,
    )

    request = Request(container_url, method="PUT")
    request.add_header("x-ms-date", x_ms_date)
    request.add_header("x-ms-version", x_ms_version)
    request.add_header("Content-Length", "0")
    request.add_header("Authorization", authorization)

    try:
        with urlopen(request, timeout=config.request_timeout_seconds) as response:
            if response.status in (201, 202, 204):
                return
    except HTTPError as exc:
        if exc.code == 409:
            return
        raise

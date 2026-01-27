import base64

import pytest

from app.azurite_sas import (
    AzuriteConfig,
    _build_shared_key_string_to_sign,
)


def _dummy_config() -> AzuriteConfig:
    # Any base64 key is fine for string-to-sign tests.
    key = base64.b64encode(b"dummy-key-32-bytes-long-........").decode("utf-8")
    return AzuriteConfig(
        endpoint="http://127.0.0.1:10000/devstoreaccount1",
        account_name="devstoreaccount1",
        account_key=key,
        container="clips",
        sas_expiry_seconds=900,
        sas_version="2020-10-02",
        sas_protocol="http",
        auto_create_container=True,
        request_timeout_seconds=0.1,
    )


def test_shared_key_string_to_sign_uses_empty_content_length_when_zero():
    config = _dummy_config()
    string_to_sign = _build_shared_key_string_to_sign(
        config=config,
        method="PUT",
        content_length=0,
        canonicalized_resource="/devstoreaccount1/clips\nrestype:container",
        x_ms_date="2026-01-27T00:00:00Z",
        x_ms_version="2020-10-02",
    )

    # The 4th line is Content-Length and must be empty when length is 0.
    lines = string_to_sign.split("\n")
    assert lines[3] == ""


def test_shared_key_string_to_sign_includes_content_length_when_nonzero():
    config = _dummy_config()
    string_to_sign = _build_shared_key_string_to_sign(
        config=config,
        method="PUT",
        content_length=123,
        canonicalized_resource="/devstoreaccount1/clips\nrestype:container",
        x_ms_date="2026-01-27T00:00:00Z",
        x_ms_version="2020-10-02",
    )

    lines = string_to_sign.split("\n")
    assert lines[3] == "123"


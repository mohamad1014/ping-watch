"""Tests for multimodal inference module."""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app import inference


def _mock_success_response(content: str) -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": content,
                }
            }
        ]
    }
    response.raise_for_status = MagicMock()
    return response


def _mock_error_response(status_code: int, text: str) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "error",
        request=MagicMock(),
        response=response,
    )
    return response


def test_build_prompt_without_user_prompt():
    result = inference.build_prompt()
    assert "security camera footage" in result.lower()


def test_build_prompt_with_user_prompt():
    result = inference.build_prompt("Focus on the front door")
    assert "Additional instructions: Focus on the front door" in result


def test_parse_inference_response_valid_json():
    response_text = '{"label": "person", "summary": "A person walking", "confidence": 0.95}'

    result = inference.parse_inference_response(response_text)

    assert result.label == "person"
    assert result.summary == "A person walking"
    assert result.confidence == 0.95


def test_parse_inference_response_includes_alert_fields():
    response_text = (
        '{"label":"person","summary":"A person entered the front door","confidence":0.91,'
        '"notify":true,"reason":"Matched person at front door rule",'
        '"matched_rules":["person at front door"],'
        '"detected_entities":["person","door"],'
        '"detected_actions":["entering"]}'
    )

    result = inference.parse_inference_response(response_text)

    assert result.should_notify is True
    assert result.alert_reason == "Matched person at front door rule"
    assert result.matched_rules == ["person at front door"]
    assert result.detected_entities == ["person", "door"]
    assert result.detected_actions == ["entering"]


def test_parse_inference_response_invalid_json_falls_back_to_unknown():
    response_text = "I see movement in the frame"

    result = inference.parse_inference_response(response_text)

    assert result.label == "unknown"
    assert result.summary == response_text
    assert result.confidence == 0.5


def test_get_hf_token_from_env(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf_test_123")
    assert inference.get_hf_token() == "hf_test_123"


def test_get_nvidia_token_from_primary_env(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test_123")
    assert inference.get_nvidia_token() == "nvapi_test_123"


def test_get_nvidia_token_from_legacy_env(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("kApiKey", "nvapi_legacy")
    assert inference.get_nvidia_token() == "nvapi_legacy"


def test_run_inference_prefers_nvidia_video(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_API_TOKEN", raising=False)

    mock_response = _mock_success_response(
        '{"label": "motion", "summary": "A person enters the room", "confidence": 0.9}'
    )

    with patch.object(httpx, "post", return_value=mock_response) as mock_post:
        result = inference.run_inference(
            clip_data=b"webm-bytes",
            clip_mime="video/webm;codecs=vp8,opus",
            user_prompt=None,
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

    assert result.label == "motion"
    assert result.provider == "nvidia"
    assert result.model == inference.DEFAULT_NVIDIA_MODEL

    mock_post.assert_called_once()
    call_args = mock_post.call_args
    assert call_args.args[0] == inference.NVIDIA_INVOKE_URL

    payload = call_args.kwargs["json"]
    assert payload["model"] == inference.DEFAULT_NVIDIA_MODEL
    user_content = payload["messages"][1]["content"]
    assert user_content[1]["type"] == "video_url"
    assert user_content[1]["video_url"]["url"].startswith("data:video/webm;base64,")
    assert "codecs=" not in user_content[1]["video_url"]["url"]


def test_run_inference_with_user_prompt_normalizes_rules(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_API_TOKEN", raising=False)
    monkeypatch.setattr(inference, "_ALERT_RULE_CACHE", {})

    normalize_response = _mock_success_response(
        '{"target_entities":["person"],"target_actions":["entering"],'
        '"locations":["front door"],"time_constraints":["22:00-06:00"],'
        '"ignore_conditions":["ignore TV"],"sensitivity":"high"}'
    )
    infer_response = _mock_success_response(
        '{"label":"person","summary":"Person entered through front door",'
        '"confidence":0.94,"notify":true,"reason":"Matched front door rule",'
        '"matched_rules":["person entering front door at night"],'
        '"detected_entities":["person","door"],'
        '"detected_actions":["entering"]}'
    )

    with patch.object(httpx, "post", side_effect=[normalize_response, infer_response]) as mock_post:
        result = inference.run_inference(
            clip_data=b"webm-bytes",
            clip_mime="video/webm",
            user_prompt="Alert me when a person enters the front door at night",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

    assert mock_post.call_count == 2
    assert result.should_notify is True
    assert result.alert_reason == "Matched front door rule"
    assert result.matched_rules == ["person entering front door at night"]


def test_run_inference_reuses_cached_normalized_rules(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test")
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_API_TOKEN", raising=False)
    monkeypatch.setattr(inference, "_ALERT_RULE_CACHE", {})

    normalize_response = _mock_success_response(
        '{"target_entities":["person"],"target_actions":["entering"],'
        '"locations":["front door"],"time_constraints":[],"ignore_conditions":[],"sensitivity":"medium"}'
    )
    infer_response_one = _mock_success_response(
        '{"label":"person","summary":"person one","confidence":0.9,"notify":true,'
        '"reason":"matched","matched_rules":["rule-1"],'
        '"detected_entities":["person"],"detected_actions":["entering"]}'
    )
    infer_response_two = _mock_success_response(
        '{"label":"person","summary":"person two","confidence":0.9,"notify":true,'
        '"reason":"matched","matched_rules":["rule-1"],'
        '"detected_entities":["person"],"detected_actions":["entering"]}'
    )

    with patch.object(
        httpx,
        "post",
        side_effect=[normalize_response, infer_response_one, infer_response_two],
    ) as mock_post:
        inference.run_inference(
            clip_data=b"webm-bytes-1",
            clip_mime="video/webm",
            user_prompt="Alert for person entering",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )
        inference.run_inference(
            clip_data=b"webm-bytes-2",
            clip_mime="video/webm",
            user_prompt="Alert for person entering",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

    # 1 normalization + 2 clip inferences
    assert mock_post.call_count == 3


def test_run_inference_falls_back_to_hf_when_nvidia_fails(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test")
    monkeypatch.setenv("HF_TOKEN", "hf_test")

    nvidia_error = _mock_error_response(503, "service unavailable")
    hf_success = _mock_success_response(
        '{"label": "person", "summary": "Person near doorway", "confidence": 0.87}'
    )

    with patch.object(httpx, "post", side_effect=[nvidia_error, hf_success]) as mock_post:
        result = inference.run_inference(
            clip_data=b"webm-bytes",
            clip_mime="video/webm",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

    assert result.label == "person"
    assert result.provider == "huggingface"
    assert result.model == inference.DEFAULT_HF_MODEL

    assert mock_post.call_count == 2
    assert mock_post.call_args_list[0].args[0] == inference.NVIDIA_INVOKE_URL
    assert mock_post.call_args_list[1].args[0] == inference.HF_ROUTER_URL


def test_run_inference_uses_hf_when_nvidia_token_missing(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("kApiKey", raising=False)
    monkeypatch.setenv("HF_TOKEN", "hf_test")

    hf_success = _mock_success_response(
        '{"label": "animal", "summary": "A cat crossed the room", "confidence": 0.77}'
    )

    with patch.object(httpx, "post", return_value=hf_success) as mock_post:
        result = inference.run_inference(
            clip_data=b"webm-bytes",
            clip_mime="video/webm",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

    assert result.provider == "huggingface"
    assert mock_post.call_args.args[0] == inference.HF_ROUTER_URL


def test_run_inference_raises_when_no_provider_credentials(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.delenv("kApiKey", raising=False)
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_API_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="No inference provider credentials"):
        inference.run_inference(
            clip_data=b"webm-bytes",
            clip_mime="video/webm",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )


def test_run_inference_requires_clip_data(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi_test")

    with pytest.raises(ValueError, match="No clip data"):
        inference.run_inference(
            clip_data=b"",
            clip_mime="video/webm",
            frame_data_uris=["data:image/jpeg;base64,ZmFrZQ=="],
        )

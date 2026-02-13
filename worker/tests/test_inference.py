"""Tests for HuggingFace Router VLM inference module."""

import json
from unittest.mock import MagicMock, patch

import httpx
import pytest

from app import inference


def test_build_prompt_without_user_prompt():
    """Test building prompt with only system pre-prompt."""
    result = inference.build_prompt()

    assert "analyzing security camera footage" in result.lower()
    assert "Additional instructions" not in result


def test_build_prompt_with_user_prompt():
    """Test building prompt with user-defined additional instructions."""
    result = inference.build_prompt("Focus on detecting animals")

    assert "analyzing security camera footage" in result.lower()
    assert "Additional instructions: Focus on detecting animals" in result


def test_build_message_content_single_frame():
    """Test building message content with a single frame."""
    frame_uri = "data:image/jpeg;base64,abc123"

    result = inference.build_message_content("Test prompt", [frame_uri])

    assert len(result) == 2
    assert result[0]["type"] == "text"
    assert result[0]["text"] == "Test prompt"
    assert result[1]["type"] == "image_url"
    assert result[1]["image_url"]["url"] == frame_uri


def test_build_message_content_multiple_frames():
    """Test building message content with multiple frames."""
    frame_uris = [
        "data:image/jpeg;base64,frame1",
        "data:image/jpeg;base64,frame2",
        "data:image/jpeg;base64,frame3",
    ]

    result = inference.build_message_content("Test prompt", frame_uris)

    assert len(result) == 4  # 1 text + 3 images
    assert result[0]["type"] == "text"
    assert all(r["type"] == "image_url" for r in result[1:])


def test_parse_inference_response_valid_json():
    """Test parsing a valid JSON response."""
    response_text = '{"label": "person", "summary": "A person walking", "confidence": 0.95}'

    result = inference.parse_inference_response(response_text)

    assert result.label == "person"
    assert result.summary == "A person walking"
    assert result.confidence == 0.95
    assert result.raw_response == response_text


def test_parse_inference_response_json_in_text():
    """Test parsing JSON embedded in other text."""
    response_text = 'Here is my analysis: {"label": "vehicle", "summary": "A car parked", "confidence": 0.87}'

    result = inference.parse_inference_response(response_text)

    assert result.label == "vehicle"
    assert result.summary == "A car parked"
    assert result.confidence == 0.87


def test_parse_inference_response_invalid_json():
    """Test handling invalid JSON response."""
    response_text = "I see a person walking in the frame"

    result = inference.parse_inference_response(response_text)

    assert result.label == "unknown"
    assert result.summary == response_text
    assert result.confidence == 0.5


def test_parse_inference_response_partial_json():
    """Test handling JSON missing some fields."""
    response_text = '{"label": "motion"}'

    result = inference.parse_inference_response(response_text)

    assert result.label == "motion"
    assert result.confidence == 0.5  # default


def test_get_hf_token_from_env(monkeypatch):
    """Test getting HF token from environment."""
    monkeypatch.setenv("HF_TOKEN", "test_token_123")

    result = inference.get_hf_token()

    assert result == "test_token_123"


def test_get_hf_token_fallback(monkeypatch):
    """Test getting HF token from fallback env var."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setenv("HF_API_TOKEN", "fallback_token")

    result = inference.get_hf_token()

    assert result == "fallback_token"


def test_get_hf_token_missing(monkeypatch):
    """Test that missing HF token raises RuntimeError."""
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.delenv("HF_API_TOKEN", raising=False)

    with pytest.raises(RuntimeError, match="Missing HF_TOKEN"):
        inference.get_hf_token()


def test_run_inference_success(monkeypatch):
    """Test successful inference call."""
    monkeypatch.setenv("HF_TOKEN", "test_token")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"label": "person", "summary": "Walking", "confidence": 0.9}'
                }
            }
        ]
    }
    mock_response.raise_for_status = MagicMock()

    with patch.object(httpx, "post", return_value=mock_response) as mock_post:
        result = inference.run_inference(
            frame_data_uris=["data:image/jpeg;base64,test"],
            user_prompt="Focus on people",
        )

    assert result.label == "person"
    assert result.summary == "Walking"
    assert result.confidence == 0.9

    # Verify API was called correctly
    mock_post.assert_called_once()
    call_kwargs = mock_post.call_args[1]
    assert call_kwargs["headers"]["Authorization"] == "Bearer test_token"
    assert "zai-org/GLM-4.6V-FP8:zai-org" in json.dumps(call_kwargs["json"])


def test_run_inference_no_frames():
    """Test that empty frames list raises ValueError."""
    with pytest.raises(ValueError, match="No frames provided"):
        inference.run_inference(frame_data_uris=[])


def test_run_inference_api_error(monkeypatch):
    """Test handling API errors."""
    monkeypatch.setenv("HF_TOKEN", "test_token")

    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Error", request=MagicMock(), response=mock_response
    )

    with patch.object(httpx, "post", return_value=mock_response):
        with pytest.raises(RuntimeError, match="Inference API error"):
            inference.run_inference(
                frame_data_uris=["data:image/jpeg;base64,test"],
            )


def test_run_inference_no_choices(monkeypatch):
    """Test handling response with no choices."""
    monkeypatch.setenv("HF_TOKEN", "test_token")

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {"choices": []}
    mock_response.raise_for_status = MagicMock()

    with patch.object(httpx, "post", return_value=mock_response):
        with pytest.raises(RuntimeError, match="No choices in API response"):
            inference.run_inference(
                frame_data_uris=["data:image/jpeg;base64,test"],
            )

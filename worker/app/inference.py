"""HuggingFace Router VLM inference."""

import json
import logging
import os
import re
from dataclasses import dataclass
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

# Default model for vision inference
DEFAULT_MODEL = "zai-org/GLM-4.6V-FP8:zai-org"

# HuggingFace Router API endpoint
HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"

# System pre-prompt for security camera analysis
SYSTEM_PREPROMPT = """You are analyzing security camera footage. Your task is to:
1. Describe what you see in the image(s)
2. Classify the type of activity or scene
3. Assess your confidence level

Respond in the following JSON format only, with no additional text:
{
    "label": "<classification label, e.g., 'person', 'animal', 'vehicle', 'motion', 'clear'>",
    "summary": "<brief natural language description of what you see>",
    "confidence": <float between 0.0 and 1.0>
}"""


@dataclass
class InferenceResult:
    """Result from VLM inference."""

    label: str
    summary: str
    confidence: float
    raw_response: Optional[str] = None


def get_hf_token() -> str:
    """Get HuggingFace API token from environment."""
    token = os.environ.get("HF_TOKEN") or os.environ.get("HF_API_TOKEN")
    if not token:
        raise RuntimeError("Missing HF_TOKEN or HF_API_TOKEN environment variable")
    token = token.strip().strip('"').strip("'")
    if token.startswith("yhf_"):
        logger.warning(
            "HF token appears invalid (starts with 'yhf_'). "
            "Use a Hugging Face access token that starts with 'hf_'."
        )
    return token


def build_prompt(user_prompt: Optional[str] = None) -> str:
    """Build the full prompt combining system pre-prompt and user prompt.

    Args:
        user_prompt: Optional user-defined additional instructions

    Returns:
        Combined prompt string
    """
    if user_prompt:
        return f"{SYSTEM_PREPROMPT}\n\nAdditional instructions: {user_prompt}"
    return SYSTEM_PREPROMPT


def build_message_content(
    prompt: str,
    frame_data_uris: list[str],
) -> list[dict]:
    """Build the message content array with text and images.

    Args:
        prompt: The text prompt
        frame_data_uris: List of base64 data URIs for frames

    Returns:
        Content array for the API message
    """
    content = [{"type": "text", "text": prompt}]

    for data_uri in frame_data_uris:
        content.append({
            "type": "image_url",
            "image_url": {"url": data_uri},
        })

    return content


def parse_inference_response(response_text: str) -> InferenceResult:
    """Parse the VLM response into structured result.

    Args:
        response_text: Raw text response from the model

    Returns:
        Parsed InferenceResult
    """
    # Try to extract JSON from the response
    try:
        # Look for JSON in the response (model might include extra text)
        json_match = re.search(r'\{[^{}]*"label"[^{}]*\}', response_text, re.DOTALL)
        if json_match:
            data = json.loads(json_match.group())
        else:
            data = json.loads(response_text)

        return InferenceResult(
            label=data.get("label", "unknown"),
            summary=data.get("summary", response_text),
            confidence=float(data.get("confidence", 0.5)),
            raw_response=response_text,
        )
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning(f"Failed to parse JSON from response: {exc}")
        # Fall back to using raw response as summary
        return InferenceResult(
            label="unknown",
            summary=response_text[:500] if response_text else "No response",
            confidence=0.5,
            raw_response=response_text,
        )


def run_inference(
    frame_data_uris: list[str],
    user_prompt: Optional[str] = None,
    model: Optional[str] = None,
    timeout: float = 60.0,
) -> InferenceResult:
    """Run VLM inference on frames.

    Args:
        frame_data_uris: List of base64 data URIs for frames
        user_prompt: Optional user-defined additional prompt
        model: Model to use (defaults to DEFAULT_MODEL)
        timeout: Request timeout in seconds

    Returns:
        InferenceResult with label, summary, and confidence

    Raises:
        RuntimeError: If inference fails
    """
    if not frame_data_uris:
        raise ValueError("No frames provided for inference")

    token = get_hf_token()
    model = model or DEFAULT_MODEL
    prompt = build_prompt(user_prompt)
    content = build_message_content(prompt, frame_data_uris)

    logger.info(f"Running inference with model {model} on {len(frame_data_uris)} frame(s)")

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "max_tokens": 500,
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    try:
        response = httpx.post(
            HF_ROUTER_URL,
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()

        # Extract response text from OpenAI-compatible format
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("No choices in API response")

        message = choices[0].get("message", {})
        response_text = message.get("content", "")

        logger.info(f"Received response: {response_text[:200]}...")

        return parse_inference_response(response_text)

    except httpx.HTTPStatusError as exc:
        logger.error(f"HTTP error during inference: {exc.response.status_code} - {exc.response.text}")
        if exc.response.status_code == 401:
            raise RuntimeError(
                "Inference authentication failed (401 Unauthorized): "
                "check HF_TOKEN/HF_API_TOKEN."
            ) from exc
        raise RuntimeError(f"Inference API error: {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        logger.error(f"Request error during inference: {exc}")
        raise RuntimeError(f"Inference request failed: {exc}") from exc
    except Exception as exc:
        logger.error(f"Unexpected error during inference: {exc}")
        raise RuntimeError(f"Inference failed: {exc}") from exc

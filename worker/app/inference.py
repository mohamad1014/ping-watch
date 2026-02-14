"""Multimodal inference with NVIDIA primary and Hugging Face fallback."""

import base64
import json
import logging
import os
from dataclasses import dataclass, field
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

DEFAULT_HF_MODEL = "zai-org/GLM-4.6V-FP8:zai-org"
DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-nano-12b-v2-vl"

HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"
NVIDIA_INVOKE_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

HF_TOKEN_ENV_VARS = ("HF_TOKEN", "HF_API_TOKEN")
NVIDIA_TOKEN_ENV_VARS = ("NVIDIA_API_KEY", "NV_API_KEY", "K_API_KEY", "kApiKey")

# NVIDIA docs indicate video mode should use /no_think.
NVIDIA_SYSTEM_PROMPT = "/no_think"
SUPPORTED_VIDEO_MIME_TYPES = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "video/mov",
}

INTENT_NORMALIZATION_PROMPT = """You are an assistant that converts natural-language security alert requests into strict JSON rules.
Return JSON only, with this exact shape:
{
  "target_entities": ["..."],
  "target_actions": ["..."],
  "locations": ["..."],
  "time_constraints": ["..."],
  "ignore_conditions": ["..."],
  "sensitivity": "low|medium|high"
}"""

DEFAULT_RULE_SET = {
    "target_entities": [],
    "target_actions": [],
    "locations": [],
    "time_constraints": [],
    "ignore_conditions": [],
    "sensitivity": "medium",
}

SCENE_ANALYSIS_PROMPT = """You are analyzing security camera footage.
Given a video clip and user alert rules, decide whether this clip should trigger a user alert.

Return JSON only in this schema:
{
  "label": "person|animal|vehicle|motion|clear|unknown",
  "summary": "1-2 sentence summary of the clip",
  "confidence": 0.0,
  "notify": false,
  "reason": "why this should or should not alert",
  "matched_rules": ["..."] ,
  "detected_entities": ["..."],
  "detected_actions": ["..."]
}
"""

_ALERT_RULE_CACHE: dict[str, dict[str, Any]] = {}
_ALERT_RULE_CACHE_LIMIT = 256


@dataclass
class InferenceResult:
    """Result from VLM inference."""

    label: str
    summary: str
    confidence: float
    provider: str = "unknown"
    model: Optional[str] = None
    should_notify: bool = False
    alert_reason: str = "No alert criteria matched"
    matched_rules: list[str] = field(default_factory=list)
    detected_entities: list[str] = field(default_factory=list)
    detected_actions: list[str] = field(default_factory=list)
    raw_response: Optional[str] = None


def _read_token(env_var_names: tuple[str, ...]) -> Optional[str]:
    for env_var_name in env_var_names:
        token = os.environ.get(env_var_name)
        if not token:
            continue
        token = token.strip().strip('"').strip("'")
        if token:
            return token
    return None


def get_hf_token() -> str:
    """Get Hugging Face API token from environment."""
    token = _read_token(HF_TOKEN_ENV_VARS)
    if not token:
        raise RuntimeError("Missing HF_TOKEN or HF_API_TOKEN environment variable")
    if token.startswith("yhf_"):
        logger.warning(
            "HF token appears invalid (starts with 'yhf_'). "
            "Use a Hugging Face access token that starts with 'hf_'."
        )
    return token


def get_nvidia_token() -> str:
    """Get NVIDIA API token from environment."""
    token = _read_token(NVIDIA_TOKEN_ENV_VARS)
    if not token:
        raise RuntimeError(
            "Missing NVIDIA_API_KEY (also checked NV_API_KEY, K_API_KEY, kApiKey)"
        )
    if not token.startswith("nvapi-"):
        logger.warning("NVIDIA token does not start with 'nvapi-'; verify your key.")
    return token


def build_prompt(user_prompt: Optional[str] = None) -> str:
    """Build a plain analysis prompt for backwards compatibility."""
    if user_prompt:
        return (
            f"{SCENE_ANALYSIS_PROMPT}\n\n"
            f"Additional instructions: {user_prompt}\n"
            f"User alert request: {user_prompt}"
        )
    return SCENE_ANALYSIS_PROMPT


def build_hf_message_content(prompt: str, frame_data_uris: list[str]) -> list[dict]:
    """Build a Hugging Face content array with text and images."""
    content = [{"type": "text", "text": prompt}]

    for data_uri in frame_data_uris:
        content.append({
            "type": "image_url",
            "image_url": {"url": data_uri},
        })

    return content


def build_message_content(prompt: str, frame_data_uris: list[str]) -> list[dict]:
    """Backward-compatible alias for tests/code using the previous helper name."""
    return build_hf_message_content(prompt, frame_data_uris)


def build_nvidia_message_content(prompt: str, video_data_uri: str) -> list[dict]:
    """Build NVIDIA content array with text and a single video object."""
    return [
        {"type": "text", "text": prompt},
        {
            "type": "video_url",
            "video_url": {
                "url": video_data_uri,
            },
        },
    ]


def _to_data_uri(binary_data: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(binary_data).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def _normalize_video_mime(clip_mime: str | None) -> str:
    raw_mime = (clip_mime or "").strip().lower()
    if not raw_mime:
        return "video/webm"

    # Browsers often report values like "video/webm;codecs=vp8,opus".
    # Strip parameters so commas don't break data-URL parsing.
    base_mime = raw_mime.split(";", 1)[0].strip()
    if base_mime in SUPPORTED_VIDEO_MIME_TYPES:
        return base_mime
    if base_mime.startswith("video/"):
        return base_mime
    return "video/webm"


def _extract_response_text(content: object) -> str:
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        text_segments: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_value = item.get("text")
                if isinstance(text_value, str):
                    text_segments.append(text_value)
        if text_segments:
            return "\n".join(text_segments)

    return json.dumps(content)


def _extract_json_object(response_text: str) -> dict[str, Any]:
    response_text = (response_text or "").strip()
    if not response_text:
        return {}

    try:
        parsed = json.loads(response_text)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    start = response_text.find("{")
    end = response_text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return {}

    candidate = response_text[start : end + 1]
    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        return {}

    return {}


def _to_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        if isinstance(item, str):
            clean = item.strip()
            if clean:
                result.append(clean)
    return result


def parse_inference_response(response_text: str) -> InferenceResult:
    """Parse the VLM response into a structured result."""
    data = _extract_json_object(response_text)
    if not data:
        return InferenceResult(
            label="unknown",
            summary=response_text[:500] if response_text else "No response",
            confidence=0.5,
            raw_response=response_text,
        )

    matched_rules = _to_string_list(data.get("matched_rules"))
    detected_entities = _to_string_list(data.get("detected_entities"))
    detected_actions = _to_string_list(data.get("detected_actions"))

    notify_raw = data.get("notify")
    if isinstance(notify_raw, bool):
        should_notify = notify_raw
    elif isinstance(notify_raw, (int, float)):
        should_notify = bool(notify_raw)
    else:
        should_notify = bool(matched_rules)

    reason = data.get("reason")
    if not isinstance(reason, str) or not reason.strip():
        reason = "Matched configured alert criteria" if should_notify else "No alert criteria matched"

    summary = data.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = response_text[:500] if response_text else "No response"

    label = data.get("label")
    if not isinstance(label, str) or not label.strip():
        label = "unknown"

    confidence_raw = data.get("confidence", 0.5)
    try:
        confidence = float(confidence_raw)
    except (TypeError, ValueError):
        confidence = 0.5

    return InferenceResult(
        label=label,
        summary=summary,
        confidence=confidence,
        should_notify=should_notify,
        alert_reason=reason,
        matched_rules=matched_rules,
        detected_entities=detected_entities,
        detected_actions=detected_actions,
        raw_response=response_text,
    )


def _normalize_rule_set(rule_set: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(DEFAULT_RULE_SET)
    normalized["target_entities"] = _to_string_list(rule_set.get("target_entities"))
    normalized["target_actions"] = _to_string_list(rule_set.get("target_actions"))
    normalized["locations"] = _to_string_list(rule_set.get("locations"))
    normalized["time_constraints"] = _to_string_list(rule_set.get("time_constraints"))
    normalized["ignore_conditions"] = _to_string_list(rule_set.get("ignore_conditions"))

    sensitivity = rule_set.get("sensitivity")
    if isinstance(sensitivity, str) and sensitivity.strip().lower() in {"low", "medium", "high"}:
        normalized["sensitivity"] = sensitivity.strip().lower()

    return normalized


def parse_alert_rule_set(response_text: str) -> dict[str, Any]:
    parsed = _extract_json_object(response_text)
    if not parsed:
        return dict(DEFAULT_RULE_SET)
    return _normalize_rule_set(parsed)


def _alert_rule_cache_key(user_prompt: str) -> str:
    return user_prompt.strip().lower()


def _get_cached_alert_rules(user_prompt: str) -> Optional[dict[str, Any]]:
    return _ALERT_RULE_CACHE.get(_alert_rule_cache_key(user_prompt))


def _set_cached_alert_rules(user_prompt: str, rule_set: dict[str, Any]) -> None:
    if len(_ALERT_RULE_CACHE) >= _ALERT_RULE_CACHE_LIMIT:
        _ALERT_RULE_CACHE.clear()
    _ALERT_RULE_CACHE[_alert_rule_cache_key(user_prompt)] = rule_set


def _nvidia_text_completion(
    token: str,
    user_text: str,
    model: str,
    timeout: float,
) -> str:
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": NVIDIA_SYSTEM_PROMPT},
            {"role": "user", "content": user_text},
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
        "top_p": 1.0,
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    response = httpx.post(
        NVIDIA_INVOKE_URL,
        headers=headers,
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("No choices in NVIDIA response")
    message = choices[0].get("message", {})
    return _extract_response_text(message.get("content", ""))


def _hf_text_completion(
    token: str,
    user_text: str,
    model: str,
    timeout: float,
) -> str:
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": user_text}],
        "max_tokens": 1024,
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }

    response = httpx.post(
        HF_ROUTER_URL,
        headers=headers,
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    choices = data.get("choices", [])
    if not choices:
        raise RuntimeError("No choices in Hugging Face response")
    message = choices[0].get("message", {})
    return _extract_response_text(message.get("content", ""))


def normalize_alert_instructions(
    user_prompt: str,
    *,
    nvidia_token: Optional[str],
    hf_token: Optional[str],
    nvidia_model: str,
    hf_model: str,
    timeout: float,
) -> dict[str, Any]:
    """Normalize free-form alert intent into a strict JSON ruleset."""
    prompt = (user_prompt or "").strip()
    if not prompt:
        return dict(DEFAULT_RULE_SET)

    cached = _get_cached_alert_rules(prompt)
    if cached is not None:
        return cached

    normalize_text = f"{INTENT_NORMALIZATION_PROMPT}\n\nUser alert request:\n{prompt}"

    last_error: Optional[Exception] = None

    if nvidia_token:
        try:
            text = _nvidia_text_completion(
                token=nvidia_token,
                user_text=normalize_text,
                model=nvidia_model,
                timeout=timeout,
            )
            parsed = parse_alert_rule_set(text)
            _set_cached_alert_rules(prompt, parsed)
            return parsed
        except Exception as exc:
            last_error = exc
            logger.warning("NVIDIA alert-rule normalization failed: %s", exc)

    if hf_token:
        try:
            text = _hf_text_completion(
                token=hf_token,
                user_text=normalize_text,
                model=hf_model,
                timeout=timeout,
            )
            parsed = parse_alert_rule_set(text)
            _set_cached_alert_rules(prompt, parsed)
            return parsed
        except Exception as exc:
            last_error = exc
            logger.warning("Hugging Face alert-rule normalization failed: %s", exc)

    if last_error is not None:
        logger.warning("Falling back to default alert rules: %s", last_error)
    default_rules = dict(DEFAULT_RULE_SET)
    _set_cached_alert_rules(prompt, default_rules)
    return default_rules


def build_clip_analysis_prompt(
    user_prompt: Optional[str],
    rule_set: Optional[dict[str, Any]],
) -> str:
    prompt = SCENE_ANALYSIS_PROMPT
    if user_prompt:
        prompt += f"\nUser alert request: {user_prompt.strip()}"
    if rule_set:
        prompt += f"\nNormalized alert rules JSON: {json.dumps(rule_set, ensure_ascii=True)}"
    return prompt


def run_nvidia_inference(
    clip_data: bytes,
    clip_mime: str,
    user_prompt: Optional[str] = None,
    prompt_override: Optional[str] = None,
    model: Optional[str] = None,
    timeout: float = 60.0,
    token: Optional[str] = None,
) -> InferenceResult:
    """Run primary NVIDIA video inference."""
    if not clip_data:
        raise ValueError("No clip data provided for inference")

    token = token or get_nvidia_token()
    model = model or DEFAULT_NVIDIA_MODEL
    prompt = prompt_override or build_prompt(user_prompt)

    normalized_mime = _normalize_video_mime(clip_mime)

    content = build_nvidia_message_content(
        prompt=prompt,
        video_data_uri=_to_data_uri(clip_data, normalized_mime),
    )

    logger.info("Running NVIDIA inference with model %s on %s bytes", model, len(clip_data))

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": NVIDIA_SYSTEM_PROMPT,
            },
            {
                "role": "user",
                "content": content,
            },
        ],
        "max_tokens": 1024,
        "temperature": 0.2,
        "top_p": 1.0,
        "stream": False,
    }

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    try:
        response = httpx.post(
            NVIDIA_INVOKE_URL,
            headers=headers,
            json=payload,
            timeout=timeout,
        )
        response.raise_for_status()
        data = response.json()

        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("No choices in API response")

        message = choices[0].get("message", {})
        response_text = _extract_response_text(message.get("content", ""))

        parsed = parse_inference_response(response_text)
        parsed.provider = "nvidia"
        parsed.model = model
        return parsed

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error during NVIDIA inference: %s - %s",
            exc.response.status_code,
            exc.response.text,
        )
        if exc.response.status_code == 401:
            raise RuntimeError(
                "Inference authentication failed (401 Unauthorized): "
                "check NVIDIA_API_KEY/NV_API_KEY/K_API_KEY/kApiKey."
            ) from exc
        raise RuntimeError(f"NVIDIA inference API error: {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        logger.error("Request error during NVIDIA inference: %s", exc)
        raise RuntimeError(f"NVIDIA inference request failed: {exc}") from exc


def run_hf_inference(
    frame_data_uris: list[str],
    user_prompt: Optional[str] = None,
    prompt_override: Optional[str] = None,
    model: Optional[str] = None,
    timeout: float = 60.0,
    token: Optional[str] = None,
) -> InferenceResult:
    """Run Hugging Face image-based fallback inference."""
    if not frame_data_uris:
        raise ValueError("No frames provided for Hugging Face fallback inference")

    token = token or get_hf_token()
    model = model or DEFAULT_HF_MODEL
    prompt = prompt_override or build_prompt(user_prompt)
    content = build_hf_message_content(prompt, frame_data_uris)

    logger.info(
        "Running Hugging Face fallback inference with model %s on %s frame(s)",
        model,
        len(frame_data_uris),
    )

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

        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("No choices in API response")

        message = choices[0].get("message", {})
        response_text = _extract_response_text(message.get("content", ""))

        parsed = parse_inference_response(response_text)
        parsed.provider = "huggingface"
        parsed.model = model
        return parsed

    except httpx.HTTPStatusError as exc:
        logger.error(
            "HTTP error during Hugging Face inference: %s - %s",
            exc.response.status_code,
            exc.response.text,
        )
        if exc.response.status_code == 401:
            raise RuntimeError(
                "Inference authentication failed (401 Unauthorized): "
                "check HF_TOKEN/HF_API_TOKEN."
            ) from exc
        raise RuntimeError(f"Hugging Face inference API error: {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        logger.error("Request error during Hugging Face inference: %s", exc)
        raise RuntimeError(f"Hugging Face inference request failed: {exc}") from exc


def run_inference(
    clip_data: bytes,
    clip_mime: str,
    user_prompt: Optional[str] = None,
    frame_data_uris: Optional[list[str]] = None,
    model: Optional[str] = None,
    hf_model: Optional[str] = None,
    timeout: float = 60.0,
) -> InferenceResult:
    """Run inference with NVIDIA as primary and Hugging Face as fallback."""
    if not clip_data:
        raise ValueError("No clip data provided for inference")

    frame_data_uris = frame_data_uris or []
    nvidia_token = _read_token(NVIDIA_TOKEN_ENV_VARS)
    hf_token = _read_token(HF_TOKEN_ENV_VARS)
    nvidia_model = model or DEFAULT_NVIDIA_MODEL
    fallback_hf_model = hf_model or DEFAULT_HF_MODEL

    if not nvidia_token and not hf_token:
        raise RuntimeError(
            "No inference provider credentials found. "
            "Set NVIDIA_API_KEY/NV_API_KEY/K_API_KEY/kApiKey and/or HF_TOKEN/HF_API_TOKEN."
        )

    normalized_rule_set: Optional[dict[str, Any]] = None
    if user_prompt and user_prompt.strip():
        normalized_rule_set = normalize_alert_instructions(
            user_prompt,
            nvidia_token=nvidia_token,
            hf_token=hf_token,
            nvidia_model=nvidia_model,
            hf_model=fallback_hf_model,
            timeout=timeout,
        )

    clip_prompt = build_clip_analysis_prompt(user_prompt, normalized_rule_set)
    nvidia_error: Optional[Exception] = None

    if nvidia_token:
        try:
            return run_nvidia_inference(
                clip_data=clip_data,
                clip_mime=clip_mime,
                user_prompt=user_prompt,
                prompt_override=clip_prompt,
                model=nvidia_model,
                timeout=timeout,
                token=nvidia_token,
            )
        except Exception as exc:
            nvidia_error = exc
            logger.warning("NVIDIA inference failed: %s", exc)

    if hf_token:
        if not frame_data_uris:
            if nvidia_error is not None:
                raise RuntimeError(
                    "NVIDIA inference failed and no frames are available for Hugging Face fallback"
                ) from nvidia_error
            raise RuntimeError("Hugging Face fallback requires at least one extracted frame")

        return run_hf_inference(
            frame_data_uris=frame_data_uris,
            user_prompt=user_prompt,
            prompt_override=clip_prompt,
            model=fallback_hf_model,
            timeout=timeout,
            token=hf_token,
        )

    assert nvidia_error is not None
    raise nvidia_error

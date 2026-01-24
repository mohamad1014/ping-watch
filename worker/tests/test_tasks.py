from unittest.mock import MagicMock

import httpx

from app import tasks


def build_response(url: str, payload: dict):
    request = httpx.Request("POST", url)
    return httpx.Response(200, json=payload, request=request)


def test_post_event_summary_calls_api(monkeypatch):
    response = build_response(
        "http://localhost:8000/events/evt_1/summary",
        {
            "event_id": "evt_1",
            "status": "done",
            "summary": "Motion detected",
            "label": "person",
            "confidence": 0.88,
        },
    )
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    result = tasks.post_event_summary(
        event_id="evt_1",
        summary="Motion detected",
        label="person",
        confidence=0.88,
    )

    mock_post.assert_called_once()
    assert result["status"] == "done"


def test_process_clip_posts_summary(monkeypatch):
    response = build_response(
        "http://localhost:8000/events/evt_2/summary",
        {
            "event_id": "evt_2",
            "status": "done",
            "summary": "Motion detected",
        },
    )
    mock_post = MagicMock(return_value=response)
    monkeypatch.setattr(httpx, "post", mock_post)

    result = tasks.process_clip({"event_id": "evt_2"})

    assert result["status"] == "done"
    mock_post.assert_called_once()

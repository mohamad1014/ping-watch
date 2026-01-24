from unittest.mock import MagicMock

from app import cli, tasks


def test_process_event_command_posts_summary(monkeypatch):
    mock_post = MagicMock(return_value={"status": "done"})
    monkeypatch.setattr(tasks, "post_event_summary", mock_post)

    cli.main([
        "process-event",
        "evt_123",
        "--summary",
        "Test summary",
        "--label",
        "person",
        "--confidence",
        "0.77",
    ])

    mock_post.assert_called_once_with(
        event_id="evt_123",
        summary="Test summary",
        label="person",
        confidence=0.77,
    )

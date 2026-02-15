from unittest.mock import MagicMock

from app import cli, tasks


def test_run_command_sets_up_logging_and_runs_worker(monkeypatch):
    mock_setup_logging = MagicMock(return_value=20)
    mock_run_worker = MagicMock()
    mock_logger = MagicMock()
    monkeypatch.setattr(cli, "setup_worker_logging", mock_setup_logging)
    monkeypatch.setattr(cli, "run_worker", mock_run_worker)
    monkeypatch.setattr(cli, "logger", mock_logger)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("NOTIFY_WEBHOOK_URL", raising=False)

    cli.main(["run", "--queue", "clip_uploaded"])

    mock_setup_logging.assert_called_once_with()
    mock_logger.info.assert_called_once()
    mock_run_worker.assert_called_once_with(queue_name="clip_uploaded")


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

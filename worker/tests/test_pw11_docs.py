from pathlib import Path


def test_docs_consistency_script_guards_pw11_runbooks_and_dashboard_baseline():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "check-docs-consistency"
    content = script.read_text()

    assert 'require_file "$repo_root/PROGRESS.md"' in content
    assert "docs/queue-stall-runbook.md" in content
    assert "docs/notification-failure-runbook.md" in content
    assert "docs/observability-dashboard-baseline.md" in content
    assert "README.md missing PROGRESS.md" in content
    assert "AGENTS.md missing PROGRESS.md" in content
    assert "README.md missing docs/queue-stall-runbook.md" in content
    assert "README.md missing docs/notification-failure-runbook.md" in content
    assert "README.md missing docs/observability-dashboard-baseline.md" in content


def test_pw11_docs_cover_queue_stalls_notification_failures_and_dashboard_baseline():
    repo_root = Path(__file__).resolve().parents[2]
    queue_runbook = (repo_root / "docs" / "queue-stall-runbook.md").read_text()
    notification_runbook = (repo_root / "docs" / "notification-failure-runbook.md").read_text()
    dashboard_baseline = (repo_root / "docs" / "observability-dashboard-baseline.md").read_text()
    worker_logging_runbook = (repo_root / "docs" / "worker-notification-logging.md").read_text()
    progress = (repo_root / "PROGRESS.md").read_text()
    readme = (repo_root / "README.md").read_text()
    agents = (repo_root / "AGENTS.md").read_text()
    repo_map = (repo_root / "docs" / "repo-map.md").read_text()

    assert "Queue Stall Runbook" in queue_runbook
    assert "Backlog Response" in queue_runbook
    assert "Enqueued inference job" in queue_runbook
    assert "Processing clip for event" in queue_runbook

    assert "Notification Failure Runbook" in notification_runbook
    assert "Telegram video alert failed" in notification_runbook
    assert "Webhook alert failed" in notification_runbook
    assert "docs/worker-notification-logging.md" in notification_runbook

    assert "Observability Dashboard Baseline" in dashboard_baseline
    assert "queue stalls" in dashboard_baseline.lower()
    assert "notification failures" in dashboard_baseline.lower()
    assert "Queue backlog proxy" in dashboard_baseline
    assert "Notification failure count" in dashboard_baseline
    assert "docs/queue-stall-runbook.md" in dashboard_baseline
    assert "docs/notification-failure-runbook.md" in dashboard_baseline

    assert "Notification Failure Runbook" in worker_logging_runbook

    assert "## Current Status" in progress
    assert "## Completed" in progress
    assert "## In Progress" in progress
    assert "## Blocked" in progress
    assert "## Next Steps" in progress

    assert "PROGRESS.md" in readme
    assert "PROGRESS.md" in agents

    assert "docs/queue-stall-runbook.md" in readme
    assert "docs/notification-failure-runbook.md" in readme
    assert "docs/observability-dashboard-baseline.md" in readme

    assert "backend/app/routes/auth.py" in repo_map
    assert "backend/app/routes/notifications.py" in repo_map
    assert "worker/app/logging.py" in repo_map
    assert "scripts/check-migrations" in repo_map
    assert "scripts/staging-rollback-drill" in repo_map

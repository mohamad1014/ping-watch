from pathlib import Path


def test_create_wave1_worktrees_script_contains_wave1_branches():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "create-wave1-worktrees"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "feature/pw-01-device-recipient-subscriptions" in content
    assert "feature/pw-06-event-lifecycle-expansion" in content
    assert "ops/pw-10-worker-structured-logs" in content
    assert "docs/pw-11-runbooks-dashboard-baseline" in content
    assert "ops/pw-12-cicd-rollback-automation" in content
    assert "ops/pw-13-security-baseline" in content
    assert "git worktree add" in content
    assert "git pull --ff-only" in content


def test_codex_parallel_workflow_doc_covers_worktrees_and_waves():
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / "docs" / "codex-parallel-workflow.md"
    content = doc.read_text()

    assert "Codex Parallel Workflow" in content
    assert "Wave 1" in content
    assert "git worktree" in content
    assert "one Codex session per worktree" in content
    assert "./scripts/test-unit" in content
    assert "./scripts/test-integration" in content
    assert "./scripts/test-e2e" in content


def test_run_wave1_codex_script_launches_terminals_with_prompts():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "run-wave1-codex"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert 'command -v codex' in content
    assert "x-terminal-emulator" in content
    assert "gnome-terminal" in content
    assert "codex --no-alt-screen" in content
    assert "--ask-for-approval never" in content
    assert "--sandbox danger-full-access" in content
    assert "Work only on PW-01 in this branch." in content
    assert "Work only on PW-06 in this branch." in content
    assert "Do test-first." in content
    assert "feature/pw-01-device-recipient-subscriptions" in content
    assert "ops/pw-13-security-baseline" in content


def test_codex_parallel_workflow_doc_mentions_wave1_launcher():
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / "docs" / "codex-parallel-workflow.md"
    content = doc.read_text()

    assert "./scripts/run-wave1-codex" in content
    assert "launches one terminal per worktree" in content
    assert "without approval prompts" in content

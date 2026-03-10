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


def test_create_wave2_worktrees_script_contains_wave2_branches():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "create-wave2-worktrees"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "feature/pw-02-recipient-management-api" in content
    assert "feature/pw-07-queue-idempotency-job-metadata" in content
    assert "feature/pw-08-worker-failure-state-visibility" in content
    assert "git worktree add" in content
    assert "git pull --ff-only" in content


def test_create_wave3_worktrees_script_contains_wave3_branches():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "create-wave3-worktrees"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "feature/pw-03-worker-recipient-fanout" in content
    assert "feature/pw-04-frontend-recipient-controls" in content
    assert "git worktree add" in content
    assert "git pull --ff-only" in content


def test_create_wave4_worktrees_script_contains_wave4_branches():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "create-wave4-worktrees"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert "feature/pw-05-invite-share-flow" in content
    assert "feature/pw-09-notification-attempt-tracking-retries" in content
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


def test_run_wave2_codex_script_launches_terminals_with_prompts():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "run-wave2-codex"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert 'command -v codex' in content
    assert "x-terminal-emulator" in content
    assert "gnome-terminal" in content
    assert "codex --no-alt-screen" in content
    assert "--ask-for-approval never" in content
    assert "--sandbox danger-full-access" in content
    assert "Work only on PW-02 in this branch." in content
    assert "Work only on PW-07 in this branch." in content
    assert "Work only on PW-08 in this branch." in content
    assert "Do test-first." in content
    assert "feature/pw-02-recipient-management-api" in content
    assert "feature/pw-08-worker-failure-state-visibility" in content


def test_run_wave3_codex_script_launches_terminals_with_prompts():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "run-wave3-codex"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert 'command -v codex' in content
    assert "x-terminal-emulator" in content
    assert "gnome-terminal" in content
    assert "codex --no-alt-screen" in content
    assert "--ask-for-approval never" in content
    assert "--sandbox danger-full-access" in content
    assert "Work only on PW-03 in this branch." in content
    assert "Work only on PW-04 in this branch." in content
    assert "Do test-first." in content
    assert "feature/pw-03-worker-recipient-fanout" in content
    assert "feature/pw-04-frontend-recipient-controls" in content


def test_run_wave4_codex_script_launches_terminals_with_prompts():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "run-wave4-codex"
    content = script.read_text()

    assert "#!/usr/bin/env bash" in content
    assert 'command -v codex' in content
    assert "x-terminal-emulator" in content
    assert "gnome-terminal" in content
    assert "codex --no-alt-screen" in content
    assert "--ask-for-approval never" in content
    assert "--sandbox danger-full-access" in content
    assert "Work only on PW-05 in this branch." in content
    assert "Work only on PW-09 in this branch." in content
    assert "Do test-first." in content
    assert "feature/pw-05-invite-share-flow" in content
    assert "feature/pw-09-notification-attempt-tracking-retries" in content


def test_codex_parallel_workflow_doc_mentions_wave1_launcher():
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / "docs" / "codex-parallel-workflow.md"
    content = doc.read_text()

    assert "./scripts/run-wave1-codex" in content
    assert "launches one terminal per worktree" in content
    assert "without approval prompts" in content


def test_codex_parallel_workflow_doc_mentions_wave2_bootstrap_and_launcher():
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / "docs" / "codex-parallel-workflow.md"
    readme = repo_root / "README.md"
    doc_content = doc.read_text()
    readme_content = readme.read_text()

    assert "Bootstrap Wave 2" in doc_content
    assert "./scripts/create-wave2-worktrees" in doc_content
    assert "./scripts/run-wave2-codex" in doc_content
    assert "../ping-watch-pw02" in doc_content
    assert "../ping-watch-pw07" in doc_content
    assert "../ping-watch-pw08" in doc_content
    assert "./scripts/create-wave2-worktrees" in readme_content
    assert "./scripts/run-wave2-codex" in readme_content


def test_codex_parallel_workflow_doc_mentions_wave3_and_wave4_bootstrap_and_launchers():
    repo_root = Path(__file__).resolve().parents[2]
    doc = repo_root / "docs" / "codex-parallel-workflow.md"
    readme = repo_root / "README.md"
    doc_content = doc.read_text()
    readme_content = readme.read_text()

    assert "Bootstrap Wave 3" in doc_content
    assert "./scripts/create-wave3-worktrees" in doc_content
    assert "./scripts/run-wave3-codex" in doc_content
    assert "../ping-watch-pw03" in doc_content
    assert "../ping-watch-pw04" in doc_content
    assert "Bootstrap Wave 4" in doc_content
    assert "./scripts/create-wave4-worktrees" in doc_content
    assert "./scripts/run-wave4-codex" in doc_content
    assert "../ping-watch-pw05" in doc_content
    assert "../ping-watch-pw09" in doc_content
    assert "./scripts/create-wave3-worktrees" in readme_content
    assert "./scripts/run-wave3-codex" in readme_content
    assert "./scripts/create-wave4-worktrees" in readme_content
    assert "./scripts/run-wave4-codex" in readme_content

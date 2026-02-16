from pathlib import Path


def test_clip_flow_script_runs_core_checks():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "test-clip-flow"
    content = script.read_text()

    assert 'cd "$repo_root/worker"' in content
    assert "PYTHONPATH=. ./.venv/bin/pytest tests/test_frames.py -k invalid_frame_count" in content
    assert "PYTHONPATH=. ./.venv/bin/pytest tests/test_dev_script.py -k loads_repo_env_file" in content
    assert 'cd "$repo_root/e2e"' in content
    assert "AZURITE_BLOB_ENDPOINT=" in content
    assert "AZURITE_ACCOUNT_NAME=" in content
    assert "AZURITE_ACCOUNT_KEY=" in content
    assert "AZURITE_AUTO_CREATE_CONTAINER=false" in content
    assert "PING_WATCH_E2E_BACKEND_URL=http://127.0.0.1:8001" in content
    assert "--config playwright.clip-flow.config.ts" in content
    assert '--grep "critical flow: start session, upload clip, worker summary, event done"' in content

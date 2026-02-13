from pathlib import Path


def test_test_e2e_script_sets_backend_url_for_playwright():
    repo_root = Path(__file__).resolve().parents[2]
    script = repo_root / "scripts" / "test-e2e"
    content = script.read_text()

    assert "PING_WATCH_E2E_BACKEND_URL=http://127.0.0.1:8002" in content
    assert "npm test" in content

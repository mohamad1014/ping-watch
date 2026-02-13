from pathlib import Path


def test_dev_script_starts_inference_worker():
    repo_root = Path(__file__).resolve().parents[2]
    dev_script = repo_root / "scripts" / "dev"
    content = dev_script.read_text()

    assert 'cd "$repo_root/worker"' in content
    assert ".venv/bin/python -m app.cli run --queue clip_uploaded" in content

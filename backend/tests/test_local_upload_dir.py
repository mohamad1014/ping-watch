from pathlib import Path

from app.routes.events import _get_local_upload_dir


def test_default_local_upload_dir_is_repo_root_relative(monkeypatch, tmp_path):
    monkeypatch.delenv("LOCAL_UPLOAD_DIR", raising=False)
    monkeypatch.chdir(tmp_path)

    expected = Path(__file__).resolve().parents[2] / ".local_uploads"
    assert _get_local_upload_dir() == expected

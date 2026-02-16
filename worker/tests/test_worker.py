from rq import Worker
import fakeredis

from app import worker
from app.worker import build_worker


def test_build_worker_uses_queue_name():
    redis_conn = fakeredis.FakeRedis()
    worker = build_worker(queue_name="clip_uploaded", connection=redis_conn)
    assert isinstance(worker, Worker)
    assert worker.queues[0].name == "clip_uploaded"
    assert worker.connection == redis_conn


def test_run_worker_uses_env_logging_level(monkeypatch):
    mock_worker = type("MockWorker", (), {})()
    mock_worker.work_calls = []

    def _work(**kwargs):
        mock_worker.work_calls.append(kwargs)

    mock_worker.work = _work

    monkeypatch.setattr(worker, "build_worker", lambda queue_name: mock_worker)
    monkeypatch.setenv("WORKER_LOG_LEVEL", "DEBUG")

    worker.run_worker(queue_name="clip_uploaded")

    assert mock_worker.work_calls == [
        {"with_scheduler": False, "logging_level": "DEBUG"}
    ]

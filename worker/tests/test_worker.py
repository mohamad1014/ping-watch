from rq import Worker
import fakeredis

from app.worker import build_worker


def test_build_worker_uses_queue_name():
    redis_conn = fakeredis.FakeRedis()
    worker = build_worker(queue_name="clip_uploaded", connection=redis_conn)
    assert isinstance(worker, Worker)
    assert worker.queues[0].name == "clip_uploaded"
    assert worker.connection == redis_conn

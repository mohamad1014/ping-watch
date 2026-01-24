from rq import Queue
import fakeredis

from app.queue import enqueue_clip


def test_enqueue_clip_adds_job():
    redis_conn = fakeredis.FakeRedis()
    queue = Queue("clip_uploaded", connection=redis_conn)

    payload = {"event_id": "evt_123", "trigger": "motion"}
    job = enqueue_clip(payload, queue=queue)

    assert job.func_name == "app.tasks.process_clip"
    assert job.args == (payload,)

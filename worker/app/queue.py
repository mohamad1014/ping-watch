import os
from typing import Any, Optional

from redis import Redis
from rq import Queue

DEFAULT_QUEUE_NAME = "clip_uploaded"


def get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def get_queue(name: str = DEFAULT_QUEUE_NAME) -> Queue:
    redis_conn = Redis.from_url(get_redis_url())
    return Queue(name, connection=redis_conn)


def enqueue_clip(payload: dict[str, Any], queue: Optional[Queue] = None):
    queue = queue or get_queue()
    return queue.enqueue("app.tasks.process_clip", payload)

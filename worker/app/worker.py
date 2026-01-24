from redis import Redis
from rq import Queue, Worker

from app.queue import DEFAULT_QUEUE_NAME, get_redis_url


def build_worker(queue_name: str = DEFAULT_QUEUE_NAME, connection: Redis | None = None) -> Worker:
    connection = connection or Redis.from_url(get_redis_url())
    queue = Queue(queue_name, connection=connection)
    return Worker([queue], connection=connection)


def run_worker(queue_name: str = DEFAULT_QUEUE_NAME) -> None:
    worker = build_worker(queue_name=queue_name)
    worker.work(with_scheduler=False)

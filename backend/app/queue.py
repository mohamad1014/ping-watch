import logging
import os
from typing import Any, Optional

from redis import Redis
from rq import Queue

logger = logging.getLogger(__name__)

DEFAULT_QUEUE_NAME = "clip_uploaded"


def get_redis_url() -> str:
    return os.environ.get("REDIS_URL", "redis://localhost:6379/0")


def get_queue(name: str = DEFAULT_QUEUE_NAME) -> Queue:
    redis_conn = Redis.from_url(get_redis_url())
    return Queue(name, connection=redis_conn)


def enqueue_inference_job(
    event_id: str,
    session_id: str,
    clip_blob_name: str,
    clip_container: str,
    analysis_prompt: Optional[str] = None,
    queue: Optional[Queue] = None,
) -> Optional[str]:
    """Enqueue a clip for inference processing.

    Returns the job ID if successful, None if Redis is unavailable.
    """
    payload = {
        "event_id": event_id,
        "session_id": session_id,
        "clip_blob_name": clip_blob_name,
        "clip_container": clip_container,
        "analysis_prompt": analysis_prompt,
    }

    try:
        queue = queue or get_queue()
        job = queue.enqueue("app.tasks.process_clip", payload)
        logger.info(f"Enqueued inference job {job.id} for event {event_id}")
        return job.id
    except Exception as exc:
        logger.error(f"Failed to enqueue inference job for event {event_id}: {exc}")
        return None

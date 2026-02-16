import argparse
import logging
import os
from typing import Sequence

from app.logging import setup_worker_logging
from app import tasks
from app.worker import run_worker

logger = logging.getLogger(__name__)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Run the ping-watch worker")
    subparsers = parser.add_subparsers(dest="command")

    run_parser = subparsers.add_parser("run", help="Run the RQ worker")
    run_parser.add_argument(
        "--queue",
        default="clip_uploaded",
        help="Queue name to listen on",
    )

    process_parser = subparsers.add_parser(
        "process-event", help="Post a summary for a specific event"
    )
    process_parser.add_argument("event_id", help="Event id to update")
    process_parser.add_argument(
        "--summary",
        default="Motion detected",
        help="Summary text",
    )
    process_parser.add_argument("--label", default=None, help="Label for the event")
    process_parser.add_argument(
        "--confidence",
        type=float,
        default=None,
        help="Confidence score",
    )

    args = parser.parse_args(argv)

    if args.command in (None, "run"):
        level = setup_worker_logging()
        telegram_configured = bool((os.environ.get("TELEGRAM_BOT_TOKEN") or "").strip())
        webhook_configured = bool((os.environ.get("NOTIFY_WEBHOOK_URL") or "").strip())
        logger.info(
            "Worker startup: queue=%s level=%s telegram_configured=%s webhook_configured=%s",
            args.queue,
            logging.getLevelName(level),
            telegram_configured,
            webhook_configured,
        )
        run_worker(queue_name=args.queue)
        return

    if args.command == "process-event":
        tasks.post_event_summary(
            event_id=args.event_id,
            summary=args.summary,
            label=args.label,
            confidence=args.confidence,
        )
        return


if __name__ == "__main__":
    main()

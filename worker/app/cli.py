import argparse
from typing import Sequence

from app import tasks
from app.worker import run_worker


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

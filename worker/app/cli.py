import argparse

from app.worker import run_worker


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the ping-watch worker")
    parser.add_argument(
        "--queue",
        default="clip_uploaded",
        help="Queue name to listen on",
    )
    args = parser.parse_args()
    run_worker(queue_name=args.queue)


if __name__ == "__main__":
    main()

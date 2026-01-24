# Worker

Redis-backed queue worker (RQ) for local dev; production will adapt to Azure Service Bus.

Setup:
- `python3 -m venv .venv`
- `.venv/bin/pip install -r requirements.txt -r requirements-dev.txt`

Run:
- `.venv/bin/python -m app.cli run --queue clip_uploaded`

Manual event summary (dev):
- `.venv/bin/python -m app.cli process-event <event_id> --summary "Motion detected" --label person --confidence 0.88`

Test:
- `.venv/bin/python -m pytest -q`

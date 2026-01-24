# Worker

Redis-backed queue worker (RQ) for local dev; production will adapt to Azure Service Bus.

Setup:
- `python3 -m venv .venv`
- `.venv/bin/pip install -r requirements.txt -r requirements-dev.txt`

Run:
- `.venv/bin/python -m app.cli --queue clip_uploaded`

Test:
- `.venv/bin/python -m pytest -q`

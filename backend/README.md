# Backend (API)

FastAPI service.

Setup:
- `python3 -m venv .venv`
- `.venv/bin/pip install -r requirements.txt -r requirements-dev.txt`

Run:
- `.venv/bin/uvicorn app.main:app --reload`

Test:
- `.venv/bin/python -m pytest -q`

Logging:
- Structured JSON logs to stdout with ISO 8601 timestamps and request metadata.

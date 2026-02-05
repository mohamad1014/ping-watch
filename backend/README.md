# Backend (API)

FastAPI service backed by SQLAlchemy.

Setup:
- `python3 -m venv .venv`
- `.venv/bin/pip install -r requirements.txt -r requirements-dev.txt`

Run:
- `.venv/bin/uvicorn app.main:app --reload`

Test:
- `.venv/bin/python -m pytest -q`

Database:
- Default `DATABASE_URL` is `postgresql+psycopg://pingwatch:pingwatch@localhost:5432/pingwatch`.
- Migrations live in `alembic/`.
- Run migrations: `.venv/bin/alembic upgrade head` (from `backend/`, respects `DATABASE_URL` if set).
- If you point `DATABASE_URL` at SQLite for tests, use a disposable file path to avoid stale schema issues.

Logging:
- Structured JSON logs to stdout with ISO 8601 timestamps and request metadata.

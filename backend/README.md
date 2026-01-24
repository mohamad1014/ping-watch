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
- Default `DATABASE_URL` is `sqlite:///./pingwatch.db`.
- Migrations live in `alembic/`.
- Run migrations: `.venv/bin/alembic upgrade head` (from `backend/`).

Logging:
- Structured JSON logs to stdout with ISO 8601 timestamps and request metadata.

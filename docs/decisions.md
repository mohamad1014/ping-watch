# Decisions Log

## 2026-01-24

- Frontend stack: React + TypeScript (Vite).
- Backend stack: FastAPI (Python 3.11+).
- Worker: Python worker using RQ + Redis for local dev/E2E; Azure Service Bus adapter planned for prod.
- Local dependencies: Docker Compose with Postgres, Redis, Azurite Blob emulator.
- Testing: test-first for all new behavior; Vitest (frontend), pytest (backend), Playwright (E2E).
- Observability: structured backend logs (ISO 8601 timestamps, request/device/session/event ids).
- Persistence: SQLAlchemy with Alembic migrations; Postgres default for local dev and backend tests, SQLite for integration/E2E fixtures.

## 2026-02-02

- Migrations: if a local Postgres instance is pre-seeded without `alembic_version`, stamp to the latest compatible revision before applying new migrations (e.g., `alembic stamp 0002_event_metadata` then `alembic upgrade 0003_clip_upload_fields`).

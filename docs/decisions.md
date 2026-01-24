# Decisions Log

## 2026-01-24

- Frontend stack: React + TypeScript (Vite).
- Backend stack: FastAPI (Python 3.11+).
- Worker: Python worker using RQ + Redis for local dev/E2E; Azure Service Bus adapter planned for prod.
- Local dependencies: Docker Compose with Postgres, Redis, Azurite Blob emulator.
- Testing: test-first for all new behavior; Vitest (frontend), pytest (backend), Playwright (E2E).
- Observability: structured backend logs (ISO 8601 timestamps, request/device/session/event ids).
- Persistence: SQLAlchemy with Alembic migrations; SQLite default for local dev.

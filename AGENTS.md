# Repository Guidelines

## Project Structure & Module Organization

- `PLAN.md` is the primary product/architecture plan and source of truth for scope.
- `README.md` documents the current scaffold and local setup.
- Default layout (adjust only if we agree to change stacks):
  - `frontend/` — PWA (React + TypeScript).
  - `backend/` — FastAPI API service (Python).
  - `worker/` — inference/queue worker (Python).
  - `e2e/` — end-to-end tests for the full stack.
  - `infra/` — docker-compose, local emulators, and ops scripts.
- `scripts/` — developer automation (dev/test/logs).

## Build, Test, and Development Commands

Primary scripts:

- `./scripts/dev-up` — start all local dependencies (db, blob emulator, queue).
- `./scripts/dev` — run frontend + backend concurrently.
- `./scripts/test-unit` — run unit tests for frontend + backend.
- `./scripts/test-integration` — run API + DB integration tests.
- `./scripts/test-e2e` — run full-stack E2E tests (Playwright).
- `./scripts/test-all` — one command to run everything locally.
- `./scripts/logs` — tail structured backend logs with timestamps.

## Coding Style & Naming Conventions

No formatter or linter is configured yet. If you introduce one, document it and standardize:

- Indentation: 2 spaces for frontend, 4 for Python (if applicable).
- Filenames: `kebab-case` for directories, `snake_case.py` for Python modules.
- Keep public API names explicit (avoid abbreviations).

## Testing Guidelines

- Use `tests/` with file names like `test_<module>.py` or `<component>.test.ts`.
- Favor unit tests for trigger logic and integration tests for upload/inference flows.
- Document minimum coverage expectations if enforced.
- Test-first is mandatory for new behavior (write failing test before implementation).
- Add E2E coverage for core flows (session start/stop, clip upload, event timeline).

## Commit & Pull Request Guidelines

- Git history contains only the initial commit; there is no established commit convention yet.
- Use concise, imperative commit messages (e.g., “Add motion trigger prototype”).
- Pull requests should include: a short summary, links to relevant issues, and screenshots or short clips for UI changes.

## Security & Configuration Tips

- Use environment variables or a local, untracked `.env`.
- Do not commit API keys or service credentials.

## Local Dev & Observability

- Backend logs must be structured and include timestamps in ISO 8601, log level, request id, device id, session id, and event id where applicable.
- Log to stdout; local dev runs via `./scripts/dev`.
- Prefer UTC time everywhere; store timezone only for display.
- Local queue is Redis for dev/E2E; production queue remains Azure Service Bus via a small queue abstraction.

## Tooling Baseline

- Frontend: Vite + React + TypeScript, unit tests with Vitest + Testing Library.
- Backend: FastAPI (Python 3.12+), tests with pytest.
- Database: SQLAlchemy with Alembic migrations; default Postgres for local dev and backend tests (integration/E2E set `DATABASE_URL` to SQLite when needed).
- Worker: RQ + Redis locally; Azure Service Bus adapter planned for prod.
- E2E: Playwright against the full local stack.
- Local dependencies: Docker (Postgres, Azurite for Blob, queue emulator or local queue).

## Environment Flags

- `VITE_DISABLE_MEDIA=true` — skip `getUserMedia`/`MediaRecorder` capture (useful for tests/E2E).

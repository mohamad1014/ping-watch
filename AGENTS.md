# Repository Guidelines

## Project Structure & Module Organization

- `PLAN.md` is the primary product/architecture plan and source of truth for scope.
- `README.md` is currently a placeholder and should be expanded as features land.
- No source code directories are present yet (e.g., `frontend/`, `backend/`, `tests/`). When added, keep a clear top-level split by runtime or service.
- Default layout (adjust only if we agree to change stacks):
  - `frontend/` — PWA (React + TypeScript).
  - `backend/` — FastAPI API service (Python).
  - `worker/` — inference/queue worker (Python).
  - `e2e/` — end-to-end tests for the full stack.
  - `infra/` — docker-compose, local emulators, and ops scripts.
- `scripts/` — developer automation (dev/test/logs).

## Build, Test, and Development Commands

There are no build or test commands in this repository yet. When adding tooling, document it here with one-line explanations, for example:

- `npm run dev` — start the PWA dev server
- `uvicorn app.main:app --reload` — run the FastAPI API locally
- `pytest` — run the backend test suite

Target command set to standardize on once tooling lands:

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

No test framework is set up yet. Once tests exist:

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

## Local Dev & Observability (planned)

- Backend logs must be structured and include timestamps in ISO 8601, log level, request id, device id, session id, and event id where applicable.
- Log to stdout; local dev uses `docker compose logs -f backend`.
- Prefer UTC time everywhere; store timezone only for display.
- Local queue is Redis for dev/E2E; production queue remains Azure Service Bus via a small queue abstraction.

## Tooling Baseline (planned)

- Frontend: Vite + React + TypeScript, unit tests with Vitest + Testing Library.
- Backend: FastAPI (Python 3.11+), tests with pytest.
- E2E: Playwright against the full local stack.
- Local dependencies: Docker (Postgres, Azurite for Blob, queue emulator or local queue).

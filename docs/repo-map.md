# Repo Map

## Top-Level Layout

- `frontend/`: PWA (React + TypeScript, Vite)
- `backend/`: FastAPI API service (Python)
- `worker/`: background worker (Python, RQ + Redis)
- `e2e/`: Playwright tests
- `infra/`: local Docker dependencies (Postgres, Redis, Azurite)
- `scripts/`: dev/test/log tooling
- `docs/`: architecture and decisions

## Frontend (PWA)

- Entry: `frontend/src/main.tsx`
- App shell + UI: `frontend/src/App.tsx`, `frontend/src/App.css`, `frontend/src/index.css`
- API client: `frontend/src/api.ts`
- Device/session helper: `frontend/src/device.ts`
- Media capture: `frontend/src/recorder.ts`
- Motion detection: `frontend/src/motion.ts`
- Audio trigger: `frontend/src/audio.ts`
- Clip pipeline:
  - Ring buffer: `frontend/src/clipBuffer.ts`
  - Clip assembly: `frontend/src/clipAssembler.ts`
  - Local store (IndexedDB): `frontend/src/clipStore.ts`
  - Upload flow: `frontend/src/clipUpload.ts`

## Backend (FastAPI)

- App entry: `backend/app/main.py`
- Routes:
  - Sessions: `backend/app/routes/sessions.py`
  - Events: `backend/app/routes/events.py`
  - Devices: `backend/app/routes/devices.py`
- Persistence and storage:
  - DB setup: `backend/app/db.py`
  - Models: `backend/app/models.py`
  - Store helpers: `backend/app/store.py`
  - SAS generation: `backend/app/azurite_sas.py`
- Logging: `backend/app/logging.py`

## Worker

- Entry point: `worker/app/cli.py`
- RQ worker: `worker/app/worker.py`
- Queue abstraction: `worker/app/queue.py`
- Tasks: `worker/app/tasks.py`

## Infra and Scripts

- Local deps: `infra/docker-compose.yml`
- Dev/test scripts: `scripts/dev`, `scripts/dev-up`, `scripts/test-unit`, `scripts/test-integration`, `scripts/test-e2e`, `scripts/test-all`, `scripts/logs`

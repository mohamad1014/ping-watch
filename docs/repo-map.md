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
- Media capture: `frontend/src/recorder.ts`, `frontend/src/sequentialRecorder.ts`
- Motion detection: `frontend/src/motion.ts`
- Audio trigger: `frontend/src/audio.ts`
- Clip pipeline:
  - Local store (IndexedDB): `frontend/src/clipStore.ts`
  - Upload flow: `frontend/src/clipUpload.ts`
  - Processing queue: `frontend/src/clipProcessingQueue.ts`
  - Clip analysis + logging: `frontend/src/clipAnalyzer.ts`, `frontend/src/clipLogger.ts`
  - Trigger benchmarking helpers: `frontend/src/benchmarkManager.ts`
  - Hooks: `frontend/src/hooks/useMotionDetection.ts`, `frontend/src/hooks/useAudioDetection.ts`, `frontend/src/hooks/useRecordingSettings.ts`

## Backend (FastAPI)

- App entry: `backend/app/main.py`
- Routes:
  - Auth: `backend/app/routes/auth.py`
  - Sessions: `backend/app/routes/sessions.py`
  - Events: `backend/app/routes/events.py`
  - Devices: `backend/app/routes/devices.py`
  - Notifications: `backend/app/routes/notifications.py`
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
- Notification delivery: `worker/app/notifications.py`
- Structured logging: `worker/app/logging.py`
- Tasks: `worker/app/tasks.py`

## Infra and Scripts

- Local deps: `infra/docker-compose.yml`
- Dev/test scripts: `scripts/dev`, `scripts/dev-up`, `scripts/dev-down`, `scripts/test-unit`, `scripts/test-integration`, `scripts/test-e2e`, `scripts/test-all`, `scripts/test-clip-flow`, `scripts/logs`
- Migration and rollback checks: `scripts/check-migrations`, `scripts/staging-rollback-drill`
- Repo guardrails: `scripts/check-docs-consistency`, `PROGRESS.md`, `PLAN.md`, `AGENTS.md`

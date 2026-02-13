# ping-watch

Phone-as-sensor PWA that records continuously, detects motion or audio spikes, and uploads short event clips for cloud inference, summaries, and notifications.

## What It Does

- Runs a foreground monitoring session in a PWA (best on an old phone, plugged in).
- Uses a lightweight motion trigger (optional audio energy trigger).
- Builds clips with a pre-roll buffer + post-trigger capture.
- Uploads event clips to cloud storage for inference and timeline results.
- Sends notifications (Telegram + second device monitoring).
- Supports installable PWA metadata (manifest + service worker) for production builds.

## MVP Scope (Phased)

1) **Local capture + trigger**: media capture, ring buffer, motion trigger, optional audio trigger, local event list.  
2) **Cloud upload + timeline sync**: SAS uploads to blob storage, events API, processing state UI.  
3) **Inference worker + results**: queue → GPU worker → labels/summaries/tags persisted.  
4) **Notifications + monitoring**: Telegram alerts + WebSocket updates.  
5) **Optimization (later)**: smarter motion filtering and preview-frame prechecks.

## Core Architecture

### On-Device (PWA)

- WebRTC `getUserMedia` + `MediaRecorder` chunking (2–4s).
- Ring buffer (memory/IndexedDB) to keep last 10–20s.
- Motion trigger via downscaled frame differencing with debounce/cooldown.
- Optional audio energy spike trigger (RMS).
- Clip builder: PRE seconds + POST seconds, with metadata.
- Upload retry with backoff; persist pending uploads; offline/online handling.

### Cloud (Azure + FastAPI)

- **API**: auth, device registration, sessions, event records, SAS upload URL.
- **Storage**: Azure Blob for clips, PostgreSQL for users/devices/events/credits.
- **Queue**: Service Bus event `clip_uploaded`.
- **Worker**: GPU inference → labels/summary → results stored.
- **Notifications**: Telegram bot and WebSocket updates.

## Credits & Pricing

Credits measured in seconds analyzed (e.g., 1 credit = 10 seconds).  
Free tier has monthly allowance; paid tier raises limits and retention.

## Guardrails (MVP)

- Cooldown after triggers (e.g., 30s).
- Max uploads per hour per plan.
- Max clip length per plan.

## MVP-1 On-Device Validation Checklist

- Launch the PWA on a real phone, grant camera + mic permissions.
- Confirm “Capture active” appears after starting a session.
- Move in front of the camera and verify a motion-triggered clip is created.
- Enable audio trigger, make a sharp sound, and verify an audio-triggered clip.
- Check the local timeline: clips should play back and show duration/size.
- Toggle “VITE_DISABLE_MEDIA=true” and verify capture is shown as disabled.

## Status

Phase 2 complete: upload + event sync with retries/offline queue and background retry loop. Auth/credits are still pending.

## Repo Layout (current)

- `frontend/` — PWA (React + TypeScript, Vite)
- `backend/` — FastAPI API service (Python)
- `worker/` — inference/queue worker (Python)
- `e2e/` — end-to-end tests (Playwright)
- `infra/` — docker-compose for local dependencies
- `scripts/` — dev/test/logs entrypoints
- `docs/` — architecture and decisions

## Decisions (2026-01-24)

- Frontend: React + TypeScript (Vite).
- Backend: FastAPI (Python 3.12+).
- Local queue: Redis; production queue adapter will target Azure Service Bus.
- Local infra: Postgres, Redis, Azurite (Blob emulator) via Docker Compose.
- Testing: test-first; Vitest (frontend), pytest (backend), Playwright (E2E).
- Observability: structured backend logs with ISO 8601 timestamps and request/device/session/event ids.

## Local Dev Commands

- `./scripts/dev-up` — start local dependencies.
- `./scripts/dev` — run frontend + backend + worker together.
- `./scripts/test-unit` — unit tests (frontend + backend).
- `./scripts/test-integration` — API + DB integration tests.
- `./scripts/test-e2e` — Playwright E2E suite.
- `./scripts/test-all` — run all tests.
- `./scripts/logs` — tail backend logs.

## Getting Started (local)

Prereqs:
- Node.js 20+
- Python 3.12+
- Docker

Setup:
1) `cp .env.example .env`
2) `./scripts/dev-up` (Postgres, Redis, Azurite)
3) Frontend deps: `cd frontend && npm install`
4) Backend deps: `python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt`
5) E2E deps: `cd e2e && npm install && npx playwright install`
6) Worker deps: `python3 -m venv worker/.venv && worker/.venv/bin/pip install -r worker/requirements.txt -r worker/requirements-dev.txt`
7) Migrations: `cd backend && .venv/bin/alembic upgrade head`

Run:
- `./scripts/dev`

Test:
- `./scripts/test-unit`
- `./scripts/test-e2e` (requires Playwright system deps; see output of `npx playwright install` if missing)
- `./scripts/test-integration` (runs backend live-server test + Playwright integration test)

Note: backend tests default to Postgres. Run `./scripts/dev-up` first, or set `DATABASE_URL=sqlite:///./test.db` to use SQLite locally.
Note: E2E/Playwright runs use a temp SQLite database for the backend; if you override `DATABASE_URL`, ensure it points to a writable, disposable path.

## Environment

- `VITE_API_URL` — backend base URL for the frontend (default `http://localhost:8000`).
- `VITE_POLL_INTERVAL_MS` — polling interval for event refresh (default 5000).
- `VITE_UPLOAD_INTERVAL_MS` — polling interval for retrying pending uploads (default 10000).
- `VITE_DISABLE_MEDIA` — set to `true` to skip `getUserMedia`/`MediaRecorder` capture (useful for tests/E2E).
- `DATABASE_URL` — backend DB URL (default Postgres in local dev).
- `AZURITE_BLOB_ENDPOINT` / `AZURITE_ACCOUNT_NAME` / `AZURITE_ACCOUNT_KEY` — Azurite config for issuing SAS upload URLs.
- `AZURITE_CLIPS_CONTAINER` — container name for clips (default `clips`).
- `AZURITE_AUTO_CREATE_CONTAINER` — auto-create the clips container on first upload (recommended in local dev).
- `AZURITE_SAS_EXPIRY_SECONDS` — SAS expiry for upload URLs (default 900).

Frontend tests can also override poll/upload intervals via runtime globals; see `frontend/README.md`.

## Upload Pipeline (Azurite)

The “Upload stored clips” button uploads pending clips from IndexedDB to Azurite via SAS URLs issued by the backend.
While a session is active, the frontend also retries pending uploads on an interval.

If `AZURITE_BLOB_ENDPOINT` / `AZURITE_ACCOUNT_NAME` / `AZURITE_ACCOUNT_KEY` are not set, the backend falls back to a local upload URL and writes clips under `backend/.local_uploads` (override with `LOCAL_UPLOAD_DIR`).

1) Start deps: `./scripts/dev-up` (starts Azurite on `:10000`).
2) Run app: `./scripts/dev`.
3) Start monitoring → generate a few local clips (motion trigger).
4) Click “Upload stored clips” and watch events show `processing` until the worker posts summaries.

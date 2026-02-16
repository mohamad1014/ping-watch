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

Production planning is tracked in `PLAN.md` under:
- `Production readiness comparison (as of 2026-02-14)`
- `12-week milestone plan (week-by-week)`

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
- `./scripts/test-clip-flow` — rerun clip flow verification (worker decode fallback + critical E2E flow).
- `./scripts/logs` — tail backend logs.
- `docs/worker-notification-logging.md` — notification/worker logging troubleshooting checklist.

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

- `VITE_API_URL` — optional backend base URL override for the frontend. If unset, frontend uses `<current-host>:8000` (better for phone/LAN testing). Set explicitly when backend is on a different host/port.
- `VITE_AUTH_REQUIRED` — when `true`, frontend obtains/stores a bearer token via `POST /auth/dev/login` and sends `Authorization: Bearer ...` on API requests.
- `VITE_ALLOWED_HOSTS` — optional comma-separated extra hostnames allowed by the Vite dev server (useful for tunnel domains).
- `VITE_POLL_INTERVAL_MS` — polling interval for event refresh (default 5000).
- `VITE_UPLOAD_INTERVAL_MS` — polling interval for retrying pending uploads (default 10000).
- `VITE_DISABLE_MEDIA` — set to `true` to skip `getUserMedia`/`MediaRecorder` capture (useful for tests/E2E).
- `DATABASE_URL` — backend DB URL (default Postgres in local dev).
- `AUTH_REQUIRED` — when `true`, backend write endpoints (`POST`/`PUT`/`PATCH`/`DELETE`) require a bearer token.
- `AUTH_DEV_LOGIN_ENABLED` — when `true` (default), enables `POST /auth/dev/login` to mint development bearer tokens.
- `AUTH_TOKEN_TTL_SECONDS` — bearer token TTL for `POST /auth/dev/login` (default `86400`, clamped to 300..2592000).
- `AZURITE_BLOB_ENDPOINT` / `AZURITE_ACCOUNT_NAME` / `AZURITE_ACCOUNT_KEY` — Azurite config for issuing SAS upload URLs.
- `AZURITE_CLIPS_CONTAINER` — container name for clips (default `clips`).
- `AZURITE_AUTO_CREATE_CONTAINER` — auto-create the clips container on first upload (recommended in local dev).
- `AZURITE_SAS_EXPIRY_SECONDS` — SAS expiry for upload URLs (default 900).
- `TELEGRAM_BOT_TOKEN` — enables Telegram integration.
- `TELEGRAM_BOT_ONBOARDING_URL` — bot URL used by onboarding (for example `https://t.me/<your_bot>`).
- `TELEGRAM_API_BASE_URL` — optional Telegram API base URL override (default `https://api.telegram.org`; useful for tests/mocks).
- `TELEGRAM_LINK_TOKEN_TTL_SECONDS` — TTL for Telegram link attempts (default `600`, clamped to 60..3600).
- `TELEGRAM_WEBHOOK_SECRET` — optional secret token expected in `X-Telegram-Bot-Api-Secret-Token` for `/notifications/telegram/webhook`.
- `TELEGRAM_SEND_VIDEO` — when `true` (default), Telegram alerts send the clip as `sendVideo`; when `false`, sends text-only alerts.
- `NOTIFY_WEBHOOK_URL` — optional webhook endpoint to receive JSON alert payloads for `should_notify=true` events.
- `NOTIFY_WEBHOOK_SECRET` — optional static secret sent as `X-Ping-Watch-Webhook-Secret` header on webhook requests.
- `NOTIFICATION_TIMEOUT_SECONDS` — outbound notification request timeout (default 10 seconds).
- `WORKER_LOG_LEVEL` — worker log level (`DEBUG`, `INFO`, `WARNING`, ...). Set to `INFO` to see notification dispatch logs.
- `WORKER_API_TOKEN` — optional bearer token used by worker callbacks (for example `POST /events/{event_id}/summary`) when `AUTH_REQUIRED=true`.

Frontend tests can also override poll/upload intervals via runtime globals; see `frontend/README.md`.

## API quick reference

Base URL (local): `http://localhost:8000`

### Devices

`POST /devices/register`
- What it does: creates (or returns) a device record; caller may provide a stable `device_id`.
- Example request:
```bash
curl -X POST http://localhost:8000/devices/register \
  -H "Content-Type: application/json" \
  -d '{"device_id":"device-123","label":"Pixel 8"}'
```
- Example response:
```json
{
  "device_id": "device-123",
  "label": "Pixel 8",
  "created_at": "2026-02-14T20:00:00+00:00"
}
```

### Auth (dev bootstrap)

`POST /auth/dev/login`
- What it does: creates (or reuses) a development user and returns a bearer token for protected write endpoints.
- Example:
```bash
curl -X POST http://localhost:8000/auth/dev/login \
  -H "Content-Type: application/json" \
  -d '{"email":"owner@example.com"}'
```
- Example response:
```json
{
  "access_token": "<token>",
  "token_type": "bearer",
  "user_id": "9a1f5c3e-5db8-4cc5-8f57-8a1f7d6e42e4",
  "expires_at": "2026-02-17T20:00:00+00:00"
}
```

### Sessions

`POST /sessions/start`
- What it does: starts a monitoring session for a device (optional `analysis_prompt`).
- Example:
```bash
curl -X POST http://localhost:8000/sessions/start \
  -H "Content-Type: application/json" \
  -d '{"device_id":"device-123","analysis_prompt":"Alert me if someone enters."}'
```

`POST /sessions/stop`
- What it does: stops capture for a session (processing jobs may still complete).

`POST /sessions/force-stop`
- What it does: stops the session and drops queued/processing work for that session.
- Example response keys include `dropped_processing_events` and `dropped_queued_jobs`.

`GET /sessions?device_id=<id>`
- What it does: lists sessions; filter by device when query param is provided.

### Events and uploads

`POST /events`
- What it does: creates an event directly when clip metadata + clip URI are already known.

`POST /events/upload/initiate`
- What it does: creates an event and returns upload target info.
- Typical flow: call `initiate` -> upload bytes -> `finalize`.
- Example:
```bash
curl -X POST http://localhost:8000/events/upload/initiate \
  -H "Content-Type: application/json" \
  -d '{"session_id":"sess-1","device_id":"device-123","trigger_type":"motion","duration_seconds":6.0,"clip_mime":"video/webm;codecs=vp8,opus","clip_size_bytes":1900000}'
```
- Example response:
```json
{
  "event": { "event_id": "evt-1", "status": "processing" },
  "upload_url": "http://.../events/evt-1/upload",
  "blob_url": "http://.../events/evt-1/upload",
  "expires_at": "2026-02-14T20:15:00+00:00"
}
```

`PUT /events/{event_id}/upload`
- What it does: relay upload endpoint (local dev fallback path); send raw clip bytes.

`POST /events/{event_id}/upload/finalize`
- What it does: marks upload complete and enqueues inference job.
- Example:
```bash
curl -X POST http://localhost:8000/events/evt-1/upload/finalize \
  -H "Content-Type: application/json" \
  -d '{"etag":"\"abc123\""}'
```

`GET /events?session_id=<id>`
- What it does: lists events; filter by session when query param is provided.

`POST /events/{event_id}/summary`
- What it does: worker callback endpoint to persist inference results.

`GET /events/{event_id}/summary`
- What it does: fetches persisted summary/inference output for an event.

### Telegram readiness/linking

`GET /notifications/telegram/readiness?device_id=<id>`
- What it does: returns whether Telegram is enabled and linked for this device.

`POST /notifications/telegram/link/start`
- What it does: creates a short-lived one-time token and returns:
  - `connect_url` deep link `https://t.me/<bot>?start=<token>`
  - `fallback_command` (manual `/start <token>` command)
  - `link_code` raw token (for client-side fallback UX)
- Example:
```bash
curl -X POST http://localhost:8000/notifications/telegram/link/start \
  -H "Content-Type: application/json" \
  -d '{"device_id":"device-123"}'
```

`GET /notifications/telegram/link/status?device_id=<id>&attempt_id=<attempt>`
- What it does: checks whether a specific link attempt is `pending`, `expired`, or `ready`.
- Linking behavior: when status is checked, the backend also syncs bot updates via `getUpdates` so linking works even if webhook delivery is not configured yet.
- Webhook conflict handling: if Telegram reports webhook/getUpdates conflict, the backend automatically calls `deleteWebhook` (without dropping pending updates) and retries linking sync.

`POST /notifications/telegram/webhook`
- What it does: Telegram webhook endpoint. `/start <token>` validates the one-time token and links the Telegram chat to the device.

`GET /notifications/telegram/target?device_id=<id>`
- What it does: returns resolved chat target metadata (`linked`, `chat_id`) for this device.

## Upload Pipeline (Azurite)

The “Upload stored clips” button uploads pending clips from IndexedDB to Azurite via SAS URLs issued by the backend.
While a session is active, the frontend also retries pending uploads on an interval.

If `AZURITE_BLOB_ENDPOINT` / `AZURITE_ACCOUNT_NAME` / `AZURITE_ACCOUNT_KEY` are not set, the backend falls back to a local upload URL and writes clips under `./.local_uploads` at the repo root (override with `LOCAL_UPLOAD_DIR`).

1) Start deps: `./scripts/dev-up` (starts Azurite on `:10000`).
2) Run app: `./scripts/dev`.
3) Start monitoring → generate a few local clips (motion trigger).
4) Click “Upload stored clips” and watch events show `processing` until the worker posts summaries.

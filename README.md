# ping-watch

Phone-as-sensor PWA that records continuously, detects motion or audio spikes, and uploads short event clips for cloud inference, summaries, and notifications.

## What It Does

- Runs a foreground monitoring session in a PWA (best on an old phone, plugged in).
- Uses a lightweight motion trigger (optional audio energy trigger).
- Builds clips with a pre-roll buffer + post-trigger capture.
- Uploads event clips to cloud storage for inference and timeline results.
- Sends notifications (Telegram + second device monitoring).

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

## Status

Scaffolding started: repo layout, local infra compose, and decision log.

## Repo Layout (current)

- `frontend/` — PWA (React + TypeScript, Vite planned)
- `backend/` — FastAPI API service (Python)
- `worker/` — inference/queue worker (Python)
- `e2e/` — end-to-end tests (Playwright planned)
- `infra/` — docker-compose for local dependencies
- `scripts/` — dev/test/logs entrypoints
- `docs/` — architecture and decisions

## Decisions (2026-01-24)

- Frontend: React + TypeScript (Vite).
- Backend: FastAPI (Python 3.11+).
- Local queue: Redis; production queue adapter will target Azure Service Bus.
- Local infra: Postgres, Redis, Azurite (Blob emulator) via Docker Compose.
- Testing: test-first; Vitest (frontend), pytest (backend), Playwright (E2E).
- Observability: structured backend logs with ISO 8601 timestamps and request/device/session/event ids.

## Local Dev Commands (planned)

- `./scripts/dev-up` — start local dependencies.
- `./scripts/dev` — run frontend + backend together.
- `./scripts/test-unit` — unit tests (frontend + backend).
- `./scripts/test-integration` — API + DB integration tests.
- `./scripts/test-e2e` — Playwright E2E suite.
- `./scripts/test-all` — run all tests.
- `./scripts/logs` — tail backend logs.

These scripts exist as stubs until the service scaffolds are added.

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

Run:
- `./scripts/dev`

Test:
- `./scripts/test-unit`
- `./scripts/test-e2e` (requires Playwright system deps; see output of `npx playwright install` if missing)

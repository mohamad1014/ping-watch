# Ping Watch Progress

Updated: **2026-03-23**

## Purpose

This file tracks implementation progress as work happens.
Update it after each meaningful step so the repo always reflects:
- what was completed
- what is currently in progress
- what is blocked
- what should happen next

`PLAN.md` remains the source of truth for scope and priorities.
`PROGRESS.md` is the execution log and current-status tracker.

## Current Status

- Current phase: post-Wave 4 stabilization and production-hardening work.
- Focus areas:
  - observability baseline
  - CI/CD and rollback automation
  - security baseline
  - queue backlog and dead-letter visibility

## Completed

- Core phone-as-sensor monitoring flow implemented.
- Local clip persistence and upload/finalize flow implemented.
- Backend sessions/events persistence and Alembic migration flow implemented.
- Worker processing scaffold implemented.
- Multi-user auth, ownership enforcement, and account switching implemented.
- Telegram linking flow upgraded to token-based onboarding and hardened.
- Multi-recipient Telegram subscriptions implemented.
- Recipient management API implemented.
- Worker notification fanout implemented.
- Invite/share flow implemented.
- Recipient-only UI mode implemented after invite acceptance.
- Event lifecycle expanded to `queued`, `processing`, `done`, `failed`, and `canceled`.
- Queue idempotency and enqueue metadata implemented.
- Worker failure-state persistence implemented.
- Notification attempt tracking implemented.
- Wave 1 through Wave 4 work reviewed, merged, and revalidated on `main`.
- `PLAN.md` refreshed to reflect Wave 4 integration status.
- Repository consistency audit completed:
  - `README.md` status wording aligned with shipped Wave 4 functionality
  - `docs/repo-map.md` refreshed for current routes, worker modules, and scripts
  - `scripts/check-docs-consistency` now enforces `PROGRESS.md` presence and references
  - targeted docs checks passed
- Code-quality and production-risk fixes completed:
  - worker writeback endpoints now enforce `WORKER_API_TOKEN` consistently
  - duplicate invite-acceptance write removed from Telegram linking flow
  - backend startup moved to FastAPI lifespan handling
  - normal startup no longer depends on ad hoc schema creation for Postgres
  - backend unit tests now run against isolated in-memory SQLite by default
  - SQLite startup/test paths were stabilized for live-server and notification-attempt coverage
  - full unit, integration, and E2E gates passed after the fixes
- Documentation drift cleanup completed:
  - `README.md` now reflects current Telegram/webhook capabilities and current backend test defaults
  - `docs/architecture.md` now matches shipped notification, invite/share, and recipient-routing behavior
  - `docs/repo-map.md` now references the current frontend module layout instead of removed clip pipeline files
- Upload finalize guard fix completed:
  - backend now verifies that a clip exists before accepting `POST /events/{event_id}/upload/finalize`
  - missing remote/local uploads now return `409 clip upload not found` instead of enqueueing a doomed worker job
  - targeted backend tests passed for clip upload, local fallback, queue idempotency, and event failure states
  - live retest confirmed the original bad path is now rejected before enqueue

## In Progress

- No active implementation item recorded yet for this update.

## Blocked

- `main` is ahead of `origin/main` until GitHub credentials are available for push.

## Next Steps

1. Push local `main` to `origin`.
2. Finish the code-quality and production-risk audit.
3. Finish observability baseline work.
4. Extend CI/CD to deploy, migrate, and rollback automation.
5. Run the full unit/integration/E2E gate after the current backend worktree changes settle.

## Update Rules

- Update this file after each meaningful implementation step.
- Keep entries short and factual.
- Move completed work out of `In Progress` as soon as it lands.
- Record blockers explicitly with the dependency or missing prerequisite.
- Keep `Next Steps` limited to the highest-priority actions.

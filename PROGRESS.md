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
- Frontend onboarding and mode split completed:
  - added a clear owner onboarding section describing Telegram setup, alert instructions, phone placement, and when to use dev mode
  - frontend now defaults to a simplified `user` mode and persists the selected mode in local storage
  - recorder tuning, benchmark diagnostics, queued-clip controls, and manual upload controls are now hidden behind `dev` mode
  - frontend unit coverage updated for onboarding and mode behavior, and E2E coverage now opts into dev mode for the manual upload path
  - full unit, integration, and E2E gates passed after the UI update
- Frontend panel consolidation completed:
  - grouped all Telegram onboarding, recipients, invite acceptance, and share-access flows into one `Telegram` block
  - converted the main dashboard sections into minimizable panels so the UI can be collapsed down while monitoring
  - removed dev/user mode messaging from the onboarding section and kept the mode switch with session controls instead
  - updated frontend unit coverage for the grouped Telegram panel and collapsible section behavior
  - full unit, integration, and E2E gates passed after the panel restructure
- Frontend owner flow polish completed:
  - reordered the primary owner journey to `How this works`, `Telegram`, `Alert instructions`, `Monitoring controls`, `Recent events`, and `Stored clips`
  - made `Monitoring controls` stay permanently visible while keeping the other major sections collapsible
  - added a Telegram connection badge in the section header so setup state reads clearly at a glance
  - moved the session status summary into monitoring controls so the fixed action area keeps the most relevant live context together
  - updated frontend tests for section order, non-collapsible controls, and Telegram connection state, and reran full unit, integration, and E2E gates
- Telegram onboarding confidence improvements completed:
  - added a compact Telegram setup checklist for bot link, recipient subscription, and monitoring readiness directly under the Telegram status badge
  - surfaced the latest event summary inside the fixed monitoring controls panel while monitoring is active
  - added a backend-backed `Test Telegram alert` action so owners can verify alert delivery immediately after linking
  - extended frontend and backend coverage for the checklist, live summary callout, and Telegram test-alert endpoint
  - full unit, integration, and E2E gates passed after the Telegram onboarding and notification test flow update
- Alert-instruction and Telegram path clarity update completed:
  - made the Telegram section explicitly branch into `Link this phone` and `Link another phone` so owners can clearly choose between linking the monitoring phone or a separate recipient phone
  - changed alert instructions from a single freeform note into a required multi-instruction list with add/remove controls in the frontend
  - updated the session start API to accept `analysis_prompts[]`, normalize them, and accumulate them into the stored backend prompt that gets sent downstream
  - aligned frontend account, unit, integration, and E2E coverage with the new required-instruction flow
  - reran full unit, integration, and E2E gates successfully after the contract and onboarding updates
- Telegram path selector refinement completed:
  - replaced the side-by-side Telegram path content with a compact chooser so users explicitly select `This phone` or `Another phone` before seeing setup details
  - kept the owner/device setup focused on linking the monitoring phone and moved invite/share actions behind the `Another phone` choice
  - updated frontend tests to cover the chooser behavior and the invite/share flows under the new selection model
  - reran full unit, integration, and E2E gates successfully after the Telegram selector update
- Frontend wording and examples refresh completed:
  - replaced the product-style top heading with a plain-language description of what the app does
  - rewrote onboarding and Telegram copy to be more direct about alert destinations, alert-writing, and physical placement
  - added multiple visible example alert instructions to help users write clearer prompts
  - updated frontend and E2E coverage for the new headline and copy, then reran full unit, integration, and E2E gates successfully
- Telegram empty states and monitoring readiness polish completed:
  - added path-specific Telegram summary cards with clear next actions for linking this phone or another phone
  - added a final pre-start checklist with explicit plug-in and camera-aim confirmations plus an alert preview flow
  - moved the Telegram test action into monitoring readiness and tightened mobile spacing for the owner flow
  - updated frontend account and E2E coverage, then reran full unit, integration, and E2E gates successfully

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

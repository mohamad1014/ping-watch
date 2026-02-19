# Ping Watch Plan

Updated: **2026-02-16 (feature-005/telegram-recipient-subscriptions)**

## 1) Goal

Ship a reliable private beta for **phone-as-sensor monitoring**:
- Foreground PWA captures clips from motion/audio triggers.
- Event clips upload to cloud and get summarized.
- Alerts are delivered (Telegram first).
- System is stable enough for real users, not just local demo flows.

## 2) Scope for This Plan

In scope:
- Device-centric monitoring flow (capture -> upload -> process -> alert).
- Reliability, observability, and rollout readiness.
- Multi-user auth/ownership and Telegram recipient model hardening for production.

Out of scope for now:
- Native background capture (Capacitor wrapper remains later work).
- Advanced motion science (ROI editor, heavy filtering, preview-frame triage).
- Billing UX and full paid-tier monetization implementation.

## 3) Current Product Snapshot

### Completed

- Frontend PWA capture loop with motion trigger and optional audio trigger.
- Local clip persistence and timeline playback.
- Upload pipeline with retries/offline queue and finalize flow.
- Backend sessions/events APIs and DB persistence with Alembic.
- Worker pipeline skeleton with summary persistence and outbound notification hooks.
- Backend auth/session model + middleware are active for protected writes.
- Ownership enforcement is active across devices/sessions/events and protected read paths.
- Frontend attaches bearer tokens on protected writes (with refresh-on-401 retry).
- Frontend account/session UX now supports explicit sign-in, sign-out, and account switching.
- Frontend ownership-scoped fetching is validated in E2E (cross-account events are isolated).
- Telegram device-linking flow upgraded to token-based onboarding:
  - `POST /notifications/telegram/link/start`
  - `GET /notifications/telegram/link/status`
  - `POST /notifications/telegram/webhook`
- Telegram linking hardening:
  - one-time token fingerprint logging (no raw token logging)
  - webhook JSON shape validation and safe ignore path
- Telegram Phase 1 recipient foundation shipped:
  - `notification_endpoints` table added.
  - `devices.telegram_endpoint_id` mapping added.
  - readiness/target resolution uses endpoint mapping (legacy fields still supported).
- Worker Telegram routing now uses per-device chat lookup (legacy fallback removed).
- CORS and frontend host support expanded for LAN and ngrok workflows.
- Unit/integration/E2E suites are passing in the current branch.

### Partially complete

- Inference pipeline is operational as a scaffold, but not production-grade GPU queueing.
- Notification delivery works, but delivery tracking/retry policy needs hardening.
- Multi-recipient Telegram subscriptions per device are not implemented yet.
- Recipient invite/share and permission flows are not implemented yet.
- Observability exists in logs, but dashboards/alerts/runbooks are incomplete.

### Not started / missing for production

- Multi-recipient subscription model and recipient-management APIs/UI.
- Recipient invite/share flow with permissions and revocation.
- CI/CD deployment pipeline with staged rollout + rollback automation.
- Security baseline (rate limits, secret rotation process, scan gates).
- Performance SLO validation and soak/load testing.

## 4) Production Readiness Comparison

| Area | Current state | Production target | Gap |
|---|---|---|---|
| Identity & access | Auth middleware + ownership checks + frontend account/session UX are implemented | Role/share model + recipient permissions | Medium |
| Data/storage path | Upload + persistence working | Managed env parity, retention + cleanup policies | Medium |
| Queue/worker reliability | Basic queue flow and retries | Idempotency guarantees, dead-letter handling, backlog controls | Medium |
| Notifications | Telegram link flow works with endpoint-mapping foundation | Multi-recipient routing, delivery tracking, retry policy, operator visibility | Medium |
| Observability | Structured logs and test coverage | Metrics dashboards, alerting, runbooks | Medium |
| Security | Basic env/config protections | Rate limiting, secret lifecycle, CI security gates | High |
| Delivery process | Local scripts and manual workflows | Automated CI/CD, migrations, rollback drills | High |
| Performance/SLO | Functional correctness validated | Measured SLOs and soak-test pass | High |

## 5) Epic Roadmap (feature-based)

| Epic | Scope | Exit criteria |
|---|---|---|
| E1: Scope + SLO Baseline | Lock private beta scope, reliability targets, and out-of-scope cuts | Scope document and SLO targets are approved; implementation backlog is prioritized |
| E2: Identity Foundation ✅ | Add user auth/session model and backend auth middleware | Protected write endpoints require auth; auth tests pass |
| E3: Ownership + Authorization ✅ | Enforce user-to-device/session/event ownership across API paths | Cross-user access is blocked in API/integration tests |
| E4: Frontend Account Flows ✅ | Add frontend auth/session lifecycle and ownership-scoped fetching | Users only see their own devices/events in E2E |
| E5: Queue + Worker Reliability | Add idempotency keys, retry model, and explicit failed states | No silent drops; failed states are persisted and test-covered |
| E6: Notification Reliability ◑ | Track notification attempts and delivery outcomes | Delivery attempts/success/failure reasons are queryable |
| E7: Observability + Runbooks | Add metrics dashboards, alerting, and failure playbooks | Queue depth/failure/latency and notification health are visible and actionable |
| E8: Delivery Automation | Build CI/CD with migrations and rollback automation | Repeatable deploy/migrate/rollback is validated in staging |
| E9: Security Hardening | Add rate limits, secret lifecycle process, and scan gates | No unresolved critical/high security findings at release gate |
| E10: Performance + Retention | Validate SLO under load and implement retention cleanup jobs | Soak/load targets met and retention cleanup verified |
| E11: Beta Operations | Prepare onboarding and incident response workflows | Beta users can onboard; top incidents have documented response paths |
| E12: Launch Readiness | Final release gate and go/no-go checklist | Launch checklist is complete and signed off |

### Capability gates

- **Gate A (after E4):** Multi-user isolation is complete end-to-end.
- **Gate B (after E8):** Deployment + rollback process is reliable.
- **Gate C (after E12):** Launch readiness is validated.

## 6) Execution Queue (current)

### Now

1. Implement multi-recipient subscriptions per device (Phase 2).
2. Add recipient-management APIs and frontend controls.
3. Implement recipient invite/share flow with ownership-aware permissions.

### Next

1. Queue idempotency keys and failure-state visibility.
2. Notification delivery status model (attempts, success/fail reason, retryable flag).
3. Baseline dashboards for API latency, worker failures, queue backlog.

### After

1. Draft rollback + incident runbook skeletons.
2. Automate CI deploy/migrate/rollback validation in staging.

## 7) Definition of Done for Private Beta

Private beta is considered ready when all are true:

1. Authenticated multi-user access is enforced end-to-end.
2. Event processing has no silent drop path and has observable failure states.
3. Telegram delivery is linkable per device and delivery outcomes are recorded.
4. CI validates unit/integration/E2E and migration checks on every merge.
5. On-call runbooks exist for top failure modes (upload, queue stall, notification failure).

## 8) Verification Snapshot

Verified on **2026-02-16** in this branch:

1. `cd backend && PYTHONPATH=. .venv/bin/pytest -q tests/test_notification_readiness.py` passed (`16 passed`).
2. `cd backend && PYTHONPATH=. .venv/bin/pytest -q` passed (`67 passed`).
3. `cd worker && PYTHONPATH=. .venv/bin/pytest -q` passed (`61 passed`).
4. `./scripts/test-all` passed (frontend unit, backend tests, integration, and Playwright E2E).

## 9) Operating Rules for This Plan

- Keep this file short and execution-focused.
- If a section is not tied to an action, milestone, or exit criterion, remove it.
- Update status with explicit shipped capabilities (avoid vague “recently”).
- Reflect shipped behavior only after tests pass in repo scripts:
  - `./scripts/test-unit`
  - `./scripts/test-integration`
  - `./scripts/test-e2e`

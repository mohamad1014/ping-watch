# Ping Watch Plan

Updated: **Current branch state**

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
- Multi-user auth/ownership needed for production.

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
- Telegram device-linking flow upgraded to token-based onboarding:
  - `POST /notifications/telegram/link/start`
  - `GET /notifications/telegram/link/status`
  - `POST /notifications/telegram/webhook`
- Telegram linking hardening:
  - one-time token fingerprint logging (no raw token logging)
  - webhook JSON shape validation and safe ignore path
- Worker Telegram routing now uses per-device chat lookup (legacy fallback removed).
- CORS and frontend host support expanded for LAN and ngrok workflows.
- Unit/integration/E2E suites are passing in the current branch.

### Partially complete

- Inference pipeline is operational as a scaffold, but not production-grade GPU queueing.
- Notification delivery works, but delivery tracking/retry policy needs hardening.
- Observability exists in logs, but dashboards/alerts/runbooks are incomplete.

### Not started / missing for production

- User authentication and device ownership enforcement.
- Multi-user access controls in API + frontend.
- CI/CD deployment pipeline with staged rollout + rollback automation.
- Security baseline (rate limits, secret rotation process, scan gates).
- Performance SLO validation and soak/load testing.

## 4) Production Readiness Comparison

| Area | Current state | Production target | Gap |
|---|---|---|---|
| Identity & access | Device-centric, unauthenticated flows | User auth + strict ownership checks | High |
| Data/storage path | Upload + persistence working | Managed env parity, retention + cleanup policies | Medium |
| Queue/worker reliability | Basic queue flow and retries | Idempotency guarantees, dead-letter handling, backlog controls | Medium |
| Notifications | Telegram link + delivery path works | Delivery tracking, retry policy, operator visibility | Medium |
| Observability | Structured logs and test coverage | Metrics dashboards, alerting, runbooks | Medium |
| Security | Basic env/config protections | Rate limiting, secret lifecycle, CI security gates | High |
| Delivery process | Local scripts and manual workflows | Automated CI/CD, migrations, rollback drills | High |
| Performance/SLO | Functional correctness validated | Measured SLOs and soak-test pass | High |

## 5) Epic Roadmap (feature-based)

| Epic | Scope | Exit criteria |
|---|---|---|
| E1: Scope + SLO Baseline | Lock private beta scope, reliability targets, and out-of-scope cuts | Scope document and SLO targets are approved; implementation backlog is prioritized |
| E2: Identity Foundation | Add user auth/session model and backend auth middleware | Protected write endpoints require auth; auth tests pass |
| E3: Ownership + Authorization | Enforce user-to-device/session/event ownership across API paths | Cross-user access is blocked in API/integration tests |
| E4: Frontend Account Flows | Add frontend auth/session lifecycle and ownership-scoped fetching | Users only see their own devices/events in E2E |
| E5: Queue + Worker Reliability | Add idempotency keys, retry model, and explicit failed states | No silent drops; failed states are persisted and test-covered |
| E6: Notification Reliability | Track notification attempts and delivery outcomes | Delivery attempts/success/failure reasons are queryable |
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

1. Lock v1 scope and SLO targets.
2. Implement backend auth middleware + protected endpoint policy.
3. Add device ownership schema and migration plan.

### Next

1. Frontend auth/session handling and ownership-aware data fetching.
2. Queue idempotency keys and failure-state visibility.
3. Notification delivery status model (attempts, success/fail reason, retryable flag).

### After

1. Baseline dashboards for API latency, worker failures, queue backlog.
2. Draft rollback + incident runbook skeletons.

## 7) Definition of Done for Private Beta

Private beta is considered ready when all are true:

1. Authenticated multi-user access is enforced end-to-end.
2. Event processing has no silent drop path and has observable failure states.
3. Telegram delivery is linkable per device and delivery outcomes are recorded.
4. CI validates unit/integration/E2E and migration checks on every merge.
5. On-call runbooks exist for top failure modes (upload, queue stall, notification failure).

## 8) Operating Rules for This Plan

- Keep this file short and execution-focused.
- If a section is not tied to an action, milestone, or exit criterion, remove it.
- Update status with explicit shipped capabilities (avoid vague “recently”).
- Reflect shipped behavior only after tests pass in repo scripts:
  - `./scripts/test-unit`
  - `./scripts/test-integration`
  - `./scripts/test-e2e`

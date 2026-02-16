# Ping Watch Plan

Updated: **February 15, 2026**

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

## 3) Current Product Snapshot (as of February 15, 2026)

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

## 4) Production Readiness Comparison (as of February 15, 2026)

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

## 5) 12-Week Milestone Plan (week-by-week)

Planning start: **Monday, February 16, 2026**.

| Week | Dates | Focus | Exit criteria |
|---|---|---|---|
| 1 | Feb 16-22 | Finalize production scope + SLOs + backlog cuts | Signed scope doc and prioritized implementation queue |
| 2 | Feb 23-Mar 1 | Auth foundation (users/sessions, backend middleware) | Protected write endpoints and auth tests passing |
| 3 | Mar 2-8 | Device ownership and authorization rules | Cross-user access blocked in API/integration tests |
| 4 | Mar 9-15 | Frontend auth + ownership-aware UX | Users only see own devices/events in E2E |
| 5 | Mar 16-22 | Queue hardening (retry model + idempotency + failure states) | No silent drops; failed states visible and tested |
| 6 | Mar 23-29 | Notification reliability + delivery status model | Delivery outcomes persisted and queryable |
| 7 | Mar 30-Apr 5 | Observability baseline (metrics + dashboards + alerting) | Queue depth/failure/latency visible and actionable |
| 8 | Apr 6-12 | Staging parity + CI/CD + rollback path | Repeatable deploy/migrate/rollback in staging |
| 9 | Apr 13-19 | Security hardening | Rate limits, scan gates, no unresolved critical/high issues |
| 10 | Apr 20-26 | Performance + retention jobs | Soak/load targets met; retention cleanup verified |
| 11 | Apr 27-May 3 | Private beta rollout + incident runbooks | Beta users onboarded; top incidents documented |
| 12 | May 4-10 | Launch-readiness review | Go/no-go checklist completed |

### Milestone gates

- **Gate A (end of Week 4):** Multi-user isolation is complete.
- **Gate B (end of Week 8):** Deployment + rollback process is reliable.
- **Gate C (end of Week 12):** Launch readiness is validated.

## 6) Immediate Work Queue (next 2 weeks)

### Priority 0 (must start now)

1. Lock v1 scope and SLO targets.
2. Implement backend auth middleware + protected endpoint policy.
3. Add device ownership schema and migration plan.

### Priority 1 (immediately after)

1. Frontend auth/session handling and ownership-aware data fetching.
2. Queue idempotency keys and failure-state visibility.
3. Notification delivery status model (attempts, success/fail reason, retryable flag).

### Priority 2

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
- Update status with explicit dates (avoid vague “recently”).
- Reflect shipped behavior only after tests pass in repo scripts:
  - `./scripts/test-unit`
  - `./scripts/test-integration`
  - `./scripts/test-e2e`

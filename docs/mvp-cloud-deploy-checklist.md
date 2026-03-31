# MVP Cloud Deploy Checklist

Use this checklist to deploy the current Ping Watch stack for an MVP cloud environment. It is intentionally scoped to what the repo supports today.

This checklist assumes:

- frontend stays a static PWA build
- backend and worker are deployed as separate services
- PostgreSQL, blob storage, and Redis are managed services
- the queue remains Redis/RQ for MVP cloud deploys

Do not assume the future Azure Service Bus adapter exists yet. `PLAN.md` still tracks that as later work.

## 1. Pick The MVP Cloud Shape

Choose one concrete deployment shape before provisioning anything:

- frontend: static hosting with HTTPS
- backend: one FastAPI service reachable over HTTPS
- worker: one long-running worker service on the same environment
- database: managed PostgreSQL
- blob storage: Azure Blob Storage
- queue: managed Redis
- secrets: cloud secret manager or platform-managed environment secrets

Keep the first deployment single-region and simple. Save multi-region, autoscaling, and blue/green rollout work for later hardening.

## 2. Provision Cloud Dependencies

Create and verify:

- PostgreSQL database
- Redis instance
- Azure Blob Storage account
- blob container for clips
- public HTTPS hostnames for frontend and backend
- secret storage for runtime credentials

Record the concrete values you will need during deploy:

- frontend URL
- backend URL
- `DATABASE_URL`
- Redis connection URL
- blob account name, key, endpoint, and container name
- Telegram bot URL and webhook URL

## 3. Prepare Required Secrets And Env Vars

Set these before the first deploy:

- `DATABASE_URL`
- `AUTH_REQUIRED=true`
- `WORKER_API_TOKEN`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_BOT_ONBOARDING_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `NOTIFY_WEBHOOK_SECRET` if webhook delivery is enabled
- `AZURITE_BLOB_ENDPOINT` equivalent for the real blob account
- `AZURITE_ACCOUNT_NAME` equivalent for the real blob account
- `AZURITE_ACCOUNT_KEY` equivalent for the real blob account
- `AZURITE_CLIPS_CONTAINER`
- `AZURITE_AUTO_CREATE_CONTAINER=false` after the container exists
- `VITE_API_URL`

Recommended first-pass production settings:

- `AUTH_DEV_LOGIN_ENABLED=false`
- `TELEGRAM_SEND_VIDEO=true`
- `WORKER_LOG_LEVEL=INFO`
- `NOTIFICATION_TIMEOUT_SECONDS=10`
- `INFERENCE_TIMEOUT_SECONDS=120`

Before launch, generate fresh secrets and store them outside Git:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

## 4. Build And Verify Before Deploy

Run the repo gates locally or in CI from the branch you plan to deploy:

```bash
./scripts/check-docs-consistency
./scripts/check-migrations
./scripts/staging-rollback-drill
./scripts/test-unit
./scripts/test-integration
./scripts/test-e2e
```

Do not deploy a revision that has not passed migrations, rollback drill, and the full test gate.

## 5. Prepare Storage And Webhook Integrations

Before exposing the app to users:

- create the clips blob container
- verify backend can issue upload URLs against the real blob account
- configure Telegram bot onboarding URL
- configure Telegram webhook to call the backend `/notifications/telegram/webhook` endpoint
- apply the Telegram webhook secret if you use one

Confirm the webhook route is reachable from Telegram over HTTPS.

## 6. Deploy In Safe Order

Use this order for the first MVP rollout:

1. Deploy backend and worker with secrets present but no user traffic yet.
2. Run database migrations against the target database.
3. Run `./scripts/staging-rollback-drill` against the staging or target database before broad rollout.
4. Start the worker and verify it connects to Redis successfully.
5. Deploy the frontend with `VITE_API_URL` pointing at the backend.
6. Register or refresh the Telegram webhook against the new backend URL.

Avoid deploying the frontend first. Users should not hit a backend that has not been migrated or whose worker is not yet running.

## 7. Run Post-Deploy Smoke Tests

After deployment, verify:

- frontend loads over HTTPS
- backend health and auth routes respond
- a device can sign in and start a monitoring session
- a clip can upload successfully to blob storage
- an event reaches `queued`, then `processing`, then `done`
- worker writes a summary back to the API
- Telegram linking succeeds
- `Test Telegram alert` succeeds
- shared-recipient invite flow still works

Use the current runbooks when something fails:

- `docs/queue-stall-runbook.md`
- `docs/notification-failure-runbook.md`
- `docs/worker-notification-logging.md`

## 8. Minimum Observability For MVP

Have these in place before onboarding external users:

- backend stdout logs captured by the hosting platform
- worker stdout logs captured by the hosting platform
- Redis queue depth visibility
- a saved search or dashboard for worker startup, enqueue failures, and notification failures

Start from:

- `docs/observability-dashboard-baseline.md`

## 9. Rollback Readiness

Before calling the deploy path ready, confirm:

- the previous backend and worker image or revision can be redeployed quickly
- the frontend can be rolled back independently
- the database has a tested rollback path for the latest migration
- the operator knows where queue-stall and notification-failure runbooks live

If a deploy introduces worker or notification regressions, roll back application code first before attempting manual data repair.

## 10. Explicit MVP Limits

This checklist gets the current repo to a practical cloud MVP. It does not mean full production readiness yet.

Still tracked in `PLAN.md`:

- staged deploy and rollback automation
- richer observability dashboards and alerts
- broader security hardening and scan gates
- dead-letter and backlog controls
- load and soak validation
- beta operations playbooks

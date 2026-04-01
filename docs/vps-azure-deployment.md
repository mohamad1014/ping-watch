# VPS + Azure Deployment

This document turns the MVP cloud deploy checklist into the concrete hosting shape currently planned for Ping Watch:

- app hosting on the existing VPS
- path-based routing on the same domain that already serves `/mohamad`
- Azure managed PostgreSQL
- VPS-local Redis for the cheapest MVP path
- Azure Blob Storage
- GitHub Actions manual deploys after verification

See also:

- `docs/environment-strategy.md`

## Target Hosting Shape

Frontend and API routes:

- dev frontend: `/ping-watch-dev`
- production frontend: `/ping-watch`
- staging frontend: `/ping-watch-staging`
- dev API: `/ping-watch-api-dev`
- production API: `/ping-watch-api`
- staging API: `/ping-watch-api-staging`

Private services:

- dev backend bind: `127.0.0.1:8002`
- production backend bind: `127.0.0.1:8000`
- staging backend bind: `127.0.0.1:8001`
- dev worker: internal `systemd` service only
- production worker: internal `systemd` service only
- staging worker: internal `systemd` service only

Existing website compatibility:

- keep the current `/mohamad` site in the same nginx server block
- add the Ping Watch nginx locations via an include snippet
- do not create a second conflicting server block for the same domain

## VPS Directory Layout

Suggested server layout:

```text
/var/www/ping-watch/production/app
/var/www/ping-watch/production/frontend
/var/www/ping-watch/staging/app
/var/www/ping-watch/staging/frontend
/var/www/ping-watch/dev/app
/var/www/ping-watch/dev/frontend
/etc/ping-watch/production.env
/etc/ping-watch/staging.env
/etc/ping-watch/dev.env
/etc/systemd/system/ping-watch-backend@.service
/etc/systemd/system/ping-watch-worker@.service
/etc/nginx/snippets/ping-watch-locations.conf
```

## One-Time VPS Bootstrap

Install base packages:

```bash
apt-get update
apt-get install -y ca-certificates curl git nginx python3 python3-venv python3-pip rsync
```

Create deploy directories:

```bash
mkdir -p /var/www/ping-watch/production/app
mkdir -p /var/www/ping-watch/production/frontend
mkdir -p /var/www/ping-watch/staging/app
mkdir -p /var/www/ping-watch/staging/frontend
mkdir -p /var/www/ping-watch/dev/app
mkdir -p /var/www/ping-watch/dev/frontend
mkdir -p /etc/ping-watch
chown -R www-data:www-data /var/www/ping-watch
```

Install the committed service templates:

```bash
cp infra/vps/systemd/ping-watch-backend@.service /etc/systemd/system/
cp infra/vps/systemd/ping-watch-worker@.service /etc/systemd/system/
systemctl daemon-reload
```

Install the nginx snippet:

```bash
cp infra/vps/nginx/ping-watch.locations.conf.template /etc/nginx/snippets/ping-watch-locations.conf
```

Then add this line inside the existing server block that already serves `/mohamad`:

```nginx
include /etc/nginx/snippets/ping-watch-locations.conf;
```

Validate and reload:

```bash
nginx -t
systemctl reload nginx
```

## Runtime Environment Files

Start from:

- `infra/vps/env/runtime.env.example`
- `infra/vps/env/dev.env.example`
- `infra/vps/env/staging.env.example`
- `infra/vps/env/production.env.example`

Create:

- `/etc/ping-watch/dev.env`
- `/etc/ping-watch/production.env`
- `/etc/ping-watch/staging.env`

Set at minimum:

- Azure Postgres connection string
- Redis connection string
- Azure Blob account values
- Telegram bot settings
- worker API token
- `PORT=8002` for hosted dev
- `PORT=8000` for production
- `PORT=8001` for staging

Do not keep these secrets in the repository.

## Manual GitHub Actions Deploy Flow

The deploy workflow lives in:

- `.github/workflows/deploy.yml`

Expected behavior:

1. manual `workflow_dispatch`
2. choose `staging` or `production`
3. rerun docs, migration, rollback, unit, integration, and E2E checks in GitHub Actions
4. build the frontend with the correct base path and API path
5. sync repo files plus built frontend assets to the VPS
6. run migrations on the target environment
7. restart backend and worker services

## One-Command VPS Dev Deploy

For direct deploys from your machine, use one of:

```bash
./scripts/deploy-vps-dev
./scripts/deploy-vps-staging
./scripts/deploy-vps-production
```

All three wrapper scripts call:

```bash
./scripts/deploy-vps-environment <dev|staging|production>
```

What the generic deploy flow does:

1. checks local prerequisites and verifies the target env file exists
2. runs docs consistency checks
3. builds the frontend for the correct path-based route
4. checks the VPS for `nginx`, `redis-server`, local Redis health, and nginx include wiring
5. copies the chosen env file to `/etc/ping-watch/<environment>.env`
6. syncs the repo and built frontend to `/var/www/ping-watch/<environment>`
7. runs `./scripts/deploy-vps-release <environment>` remotely
8. performs basic backend/frontend smoke checks on the VPS

Defaults:

- host: `217.154.253.21`
- user: `root`
- public origin: `http://217.154.253.21`

Override with environment variables when needed:

- `PING_WATCH_VPS_HOST`
- `PING_WATCH_VPS_USER`
- `PING_WATCH_VPS_PORT`
- `PING_WATCH_PUBLIC_ORIGIN`
- `PING_WATCH_SERVER_ROOT`

## Required GitHub Environment Secrets

Create GitHub Environments named:

- `staging`
- `production`

Each environment should provide:

- `VPS_HOST`
- `VPS_USER`
- `VPS_PORT`
- `VPS_SSH_PRIVATE_KEY`
- `PUBLIC_ORIGIN`

Optional:

- `VPS_APP_ROOT`
- `SSH_KNOWN_HOSTS`

Notes:

- `PUBLIC_ORIGIN` should be the origin that serves the shared domain, for example `https://example.com`
- the workflow derives the correct path-based frontend and API URLs from the selected environment
- the SSH user should have passwordless `sudo` for `systemctl`, `nginx -t`, and writing to the deployment paths

## Manual Server Verification

Production:

```bash
systemctl status ping-watch-backend@production
systemctl status ping-watch-worker@production
journalctl -u ping-watch-backend@production -n 100 --no-pager
journalctl -u ping-watch-worker@production -n 100 --no-pager
curl -I http://127.0.0.1:8000/docs
curl -I https://your-domain/ping-watch
curl -I https://your-domain/ping-watch-api/docs
```

Staging:

```bash
systemctl status ping-watch-backend@staging
systemctl status ping-watch-worker@staging
curl -I http://127.0.0.1:8001/docs
curl -I https://your-domain/ping-watch-staging
curl -I https://your-domain/ping-watch-api-staging/docs
```

Hosted dev:

```bash
systemctl status ping-watch-backend@dev
systemctl status ping-watch-worker@dev
curl -I http://127.0.0.1:8002/docs
curl -I https://your-domain/ping-watch-dev
curl -I https://your-domain/ping-watch-api-dev/docs
```

## Operational Notes

- The frontend is built as static files and served by nginx directly.
- The backend and worker share the same repo checkout for each environment.
- The worker remains lightweight and runs on the same VPS for now.
- If the worker grows beyond the VPS capacity later, move only the worker first.

## Current Limits

This deployment shape is a practical MVP, not the full production-hardening end state.

Still tracked separately:

- richer rollback automation
- broader observability dashboards and alerts
- HTTPS/TLS finalization if the current domain is not yet fully switched
- backup and recovery runbooks

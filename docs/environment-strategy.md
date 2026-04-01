# Environment Strategy

This repo now targets three named environments:

- `dev`: local-first developer environment. Fast iteration, disposable state, and dev-only auth shortcuts are allowed.
- `staging`: production-like VPS + Azure environment used for real-device validation before release.
- `production`: the public environment. Same runtime shape as staging, but with production secrets, stricter auth posture, and release controls.

## Goals

- Keep one codebase and one deploy shape across hosted environments.
- Make it obvious which values belong to `dev`, `staging`, and `production`.
- Prevent accidental cross-environment leaks such as staging using production secrets or routes.

## Environment Model

### Dev

- Primary use: local development and debugging.
- Hosting shape: local machine via `./scripts/dev`.
- Auth: `AUTH_DEV_LOGIN_ENABLED=true` is acceptable here.
- Storage and queue: local Postgres/Redis/Azurite via Docker Compose.
- Frontend origin: `http://localhost:5173` by default.

### Staging

- Primary use: phone testing, release rehearsal, and operator validation.
- Hosting shape: VPS app tier + Azure managed Postgres/Blob.
- Auth: protected writes on, dev bootstrap login only if temporarily needed.
- Queue: local VPS Redis for the low-cost MVP path.
- Frontend/API routes: `/ping-watch-staging` and `/ping-watch-api-staging`.

### Production

- Primary use: real users.
- Hosting shape: same as staging unless we intentionally change it later.
- Auth: protected writes on, dev bootstrap login disabled.
- Queue: same MVP VPS Redis path unless replaced later.
- Frontend/API routes: `/ping-watch` and `/ping-watch-api`.

## Config Layout

### Local source files

- `dev.env`:
  local developer env file used by `deploy-vps-dev` when we want a hosted dev slot, and as the reference for local-only defaults.
- `staging.env`:
  local source for the hosted staging runtime file.
- `production.env`:
  local source for the hosted production runtime file.

These files are intentionally untracked locally and copied to the VPS as:

- `/etc/ping-watch/dev.env`
- `/etc/ping-watch/staging.env`
- `/etc/ping-watch/production.env`

### Templates

- `infra/vps/env/runtime.env.example`:
  common reference template showing the full variable set and what each variable does.
- `infra/vps/env/dev.env.example`
- `infra/vps/env/staging.env.example`
- `infra/vps/env/production.env.example`

Use the environment-specific templates to create the real local files, and use `runtime.env.example` as the shared reference when you need to understand the variables.

## Route Mapping

Current VPS path-based route plan:

| Environment | Frontend | API | Backend port |
|---|---|---|---|
| `dev` | `/ping-watch-dev` | `/ping-watch-api-dev` | `8002` |
| `staging` | `/ping-watch-staging` | `/ping-watch-api-staging` | `8001` |
| `production` | `/ping-watch` | `/ping-watch-api` | `8000` |

## Deploy Scripts

- `./scripts/deploy-vps-environment <dev|staging|production>`:
  generic hosted deploy entrypoint.
- `./scripts/deploy-vps-dev`
- `./scripts/deploy-vps-staging`
- `./scripts/deploy-vps-production`

Each wrapper delegates to the generic script with the correct environment name.

## Auth Policy

- `dev`:
  `AUTH_REQUIRED=true` or `false` depending on what is being tested locally; `AUTH_DEV_LOGIN_ENABLED=true` is acceptable.
- `staging`:
  `AUTH_REQUIRED=true`; `AUTH_DEV_LOGIN_ENABLED` may remain temporarily enabled while validating flows, but should trend toward the production posture.
- `production`:
  `AUTH_REQUIRED=true`; `AUTH_DEV_LOGIN_ENABLED=false`.

## Secret Separation Rules

- Never reuse Telegram bot tokens, worker tokens, webhook secrets, or database credentials across environments.
- Blob containers should be separate per environment.
- Postgres databases should be separate per environment.
- GitHub Actions environments should be separate for `staging` and `production`; `dev` does not need a hosted CI environment unless we later automate it.

## Recommended Next Steps

1. Move staging to the new domain and HTTPS first.
2. Keep `dev` local by default; only use hosted `dev` if we need a third persistent VPS slot.
3. Wire production deploy only after staging runs cleanly with the new domain and secrets model.

See also:

- `docs/domain-routing-and-tls-plan.md`

# Platform Boundaries

This repository is one part of a shared VPS/domain setup.

## What Lives Here

`ping-watch` is the product application repository.

It owns:

- the Ping Watch frontend web app
- the FastAPI backend
- the worker process
- Ping Watch database/blob/queue integration
- Ping Watch environment files, deployment scripts, and runbooks

Current hosted route plan for Ping Watch:

- `dev`: `/ping-watch-dev`
- `staging`: `/ping-watch-staging`
- `production`: `/ping-watch`

Current hosted API route plan:

- `dev`: `/ping-watch-api-dev`
- `staging`: `/ping-watch-api-staging`
- `production`: `/ping-watch-api`

## What Does Not Live Here

The public/personal website for Mohamad lives in the separate repo:

- `/home/mohamad/Projects/website`

That repo owns:

- the `MAAH.nl` conversational CV site
- the `/mohamad` public route
- its own app/runtime/deployment documentation

## Shared Platform Context

Both repos currently share:

- the same VPS
- the same nginx server block
- the same top-level domain footprint

But they should remain separate products:

- separate repositories
- separate deploy logic
- separate secrets
- separate runtime processes

## Coordination Rule

When changing routing, nginx includes, domains, TLS, or VPS layout here, also check the website repo so the shared hosting model stays consistent.

See also:

- `docs/environment-strategy.md`
- `docs/vps-azure-deployment.md`

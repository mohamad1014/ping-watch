# Human Configuration

This file records the decisions and external configuration steps that were made by a human outside the repo.

It is intentionally different from code and env templates:

- code explains how the system works
- env templates explain what values are needed
- this file explains what a human already chose or configured in external systems

Do not put secrets here.

## Domain And Registrar

Chosen public domain:

- `alhajj.nl`

Additional public host:

- `www.alhajj.nl`

Registrar / control panel:

- STRATO

## STRATO DNS Configuration Already Applied

The following DNS choices were made manually in STRATO for `alhajj.nl`:

- root `A` record points to the VPS IPv4:
  - `217.154.253.21`
- root `AAAA` record points to the VPS IPv6:
  - `2a01:239:40d:1300::1`
- `www` points to the same domain using a `CNAME`:
  - `www` -> `alhajj.nl`

Relevant notes from the registrar setup:

- the domain was moved away from STRATO placeholder-style routing toward direct DNS resolution
- no subdomain-based Ping Watch setup was chosen at this stage
- current plan remains path-based on the shared domain

Items intentionally left unchanged during this step:

- `NS` records
- `MX` records
- DMARC / SPF / email-related settings

## Shared Route Choices

The current human-approved shared route layout is:

- website repo (`../website`):
  - `/mohamad`
- Ping Watch repo:
  - `/ping-watch-dev`
  - `/ping-watch-staging`
  - `/ping-watch`
  - `/ping-watch-api-dev`
  - `/ping-watch-api-staging`
  - `/ping-watch-api`

## Hosting Shape

Current hosting choice:

- one shared VPS
- one shared top-level domain
- one shared nginx site file
- Ping Watch remains a separate repo and separate app/runtime
- website remains a separate repo and separate app/runtime

Operational ownership split:

- `../website` owns the top-level nginx site file and `/mohamad`
- `ping-watch` owns the Ping Watch nginx snippet and `/ping-watch*`

## TLS Direction

Planned TLS/certificate approach:

- Certbot
- nginx integration
- certificates for:
  - `alhajj.nl`
  - `www.alhajj.nl`

## Inference Provider Choices

The following external provider tooling is part of the human-operated setup knowledge for model selection and configuration:

- NVIDIA build/config portal:
  - `https://build.nvidia.com/`
- Hugging Face model browser for inference-capable models:
  - `https://huggingface.co/inference/models`
- Hugging Face inference provider overview/settings:
  - `https://huggingface.co/settings/inference-providers/overview`

Use these when:

- choosing a hosted model
- checking provider compatibility
- validating which provider account/settings are in use
- updating runtime config for NVIDIA or Hugging Face inference

## Azure / VPS Infrastructure Choices

Human-approved infrastructure direction so far:

- PostgreSQL: Azure managed PostgreSQL
- Blob storage: Azure Blob Storage
- Redis for MVP: local VPS Redis to minimize cost
- app hosting: VPS
- backend hosting: VPS
- worker hosting: same VPS for now

## Environment Model Choices

Human-approved hosted environment layout:

- `dev`
- `staging`
- `production`

Current path-based route mapping:

- `dev`: `/ping-watch-dev`
- `staging`: `/ping-watch-staging`
- `production`: `/ping-watch`

## Notes For Future Updates

Update this file when a human changes:

- domain ownership or registrar settings
- DNS records
- TLS/certificate strategy
- inference provider choice
- hosting provider choice
- route/domain structure
- any other important operational decision made outside the repo

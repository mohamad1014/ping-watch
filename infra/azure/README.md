# Azure Managed Services IaC

This directory provisions the Azure-managed services that Ping Watch needs while keeping the VPS-hosted app layer unchanged:

- Azure Database for PostgreSQL Flexible Server
- Azure Blob Storage account and clips container
- optional Azure Managed Redis

The Bicep template is optimized for low-cost MVP defaults:

- PostgreSQL: Burstable `Standard_B1ms`, 32 GB storage, 7-day backup retention, HA disabled
- Redis: optional, default disabled for the cheapest MVP path
- Storage: `Standard_LRS`, single private clips container

## Files

- `main.bicep` - shared Azure template
- `parameters/staging.parameters.example.json` - example staging inputs
- `parameters/production.parameters.example.json` - example production inputs

## Important Cost Notes

- These defaults favor low monthly cost over high availability.
- For the lowest-cost MVP, keep `deployRedis=false` and run Redis on the VPS. This avoids paying for Azure Managed Redis entirely.
- If you later enable Azure Managed Redis, the template uses `Balanced_B0` with HA disabled to minimize cost.
- `Standard_B1ms` is the smallest practical managed PostgreSQL option, but burstable CPU credits can run out under sustained load.
- Storage uses `Standard_LRS` because it is the lowest-cost durable replication choice.

## Usage

1. Install Azure CLI with Bicep support.
2. Copy the example parameter file and fill in the real values:

```bash
cp infra/azure/parameters/staging.parameters.example.json infra/azure/parameters/staging.parameters.json
cp infra/azure/parameters/production.parameters.example.json infra/azure/parameters/production.parameters.json
```

3. Deploy one environment at a time:

```bash
./scripts/azure-deploy-managed-services staging <subscription-id> <resource-group> infra/azure/parameters/staging.parameters.json
./scripts/azure-deploy-managed-services production <subscription-id> <resource-group> infra/azure/parameters/production.parameters.json
```

With the subscriptions currently shown in your Azure account, those commands become:

```bash
./scripts/azure-deploy-managed-services staging e86ad369-6747-4f27-b4ee-c4a05e89e6b6 ping-watch-staging-rg infra/azure/parameters/staging.parameters.json
./scripts/azure-deploy-managed-services production 0c1decbe-c945-40f4-ab27-fe1069aafacc ping-watch-production-rg infra/azure/parameters/production.parameters.json
```

## Resource Group Suggestions

- staging: `ping-watch-staging-rg`
- production: `ping-watch-production-rg`

## Populate VPS Env Files After Deploy

After deployment, use the outputs plus Azure Portal or CLI values to fill:

- `/etc/ping-watch/staging.env`
- `/etc/ping-watch/production.env`

Map the resources into the app env like this:

- `DATABASE_URL`
  - format: `postgresql+psycopg://<admin-login>:<admin-password>@<server-name>.postgres.database.azure.com:5432/<db-name>?sslmode=require`
- `REDIS_URL`
  - cheapest MVP path: `redis://127.0.0.1:6379/0`
  - if Azure Managed Redis is enabled later: `rediss://:<primary-key>@<redis-host>:10000/0`
- `AZURITE_BLOB_ENDPOINT`
  - format: `https://<storage-account>.blob.core.windows.net`
- `AZURITE_ACCOUNT_NAME`
  - the storage account name
- `AZURITE_ACCOUNT_KEY`
  - a storage account access key
- `AZURITE_CLIPS_CONTAINER`
  - `clips` or `clips-staging`

## Security Notes

- Do not commit the real parameter files with passwords.
- Restrict PostgreSQL access to the VPS IP via the firewall parameters.
- Blob Storage stays publicly reachable because the browser uploads directly with SAS URLs; keep the container private and rely on short SAS expiry.
- The current parameter files are already pinned to the VPS IPv4 `217.154.253.21`; update them if the VPS IP changes later.

## Why Redis Is Disabled By Default

Your Azure subscription hit a Redis control-plane blocker related to availability-zone metadata. Rather than forcing an Azure support path for a noncritical MVP dependency, the template now defaults Redis off.

That choice is also the cheapest one:

- Postgres and Blob stay managed in Azure where they matter most
- Redis stays local on the VPS where it is lightweight and easy to operate
- the app already supports `REDIS_URL=redis://127.0.0.1:6379/0`

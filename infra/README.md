# Local Infrastructure

This compose stack is the local dependency layer for dev and tests.

Services:
- PostgreSQL 16 on `localhost:5432`
- Redis 7 on `localhost:6379` (local queue for dev/E2E)
- Azurite Blob on `localhost:10000` (Azure Blob emulator)

Run:
- `../scripts/dev-up`
- `../scripts/dev-down`

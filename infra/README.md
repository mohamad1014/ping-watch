# Local Infrastructure

This compose stack is the local dependency layer for dev and tests.

Services:
- PostgreSQL 16 on `localhost:5432`
- Redis 7 on `localhost:6379` (local queue for dev/E2E)
- Azurite Blob on `localhost:10000` (Azure Blob emulator)

Run:
- `../scripts/dev-up`
- `../scripts/dev-down`
- `../scripts/check-migrations`
- `../scripts/staging-rollback-drill`

Rollback validation:
- `../scripts/check-migrations` and `../scripts/staging-rollback-drill` default to temporary SQLite databases in CI-friendly environments.
- To exercise the local Postgres service from this compose stack, start `../scripts/dev-up` and run `DATABASE_URL=postgresql+psycopg://pingwatch:pingwatch@localhost:5432/pingwatch ../scripts/staging-rollback-drill`.

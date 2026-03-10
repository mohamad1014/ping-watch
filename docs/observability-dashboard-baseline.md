# Observability Dashboard Baseline

This baseline defines the first dashboard panels for the two PW-11 failure modes: queue stalls and notification failures.

Use current logs and Redis state as the data source. Do not depend on future metrics contracts to stand up the first version.

## Queue Stalls

### Queue backlog proxy

- Source: Redis queue depth for `rq:queue:clip_uploaded`
- Why it matters: rising depth without matching worker activity is the clearest stall signal available now
- Drill-down runbook: `docs/queue-stall-runbook.md`

Suggested local query:

```bash
docker compose -f infra/docker-compose.yml exec redis redis-cli LLEN rq:queue:clip_uploaded
```

### Enqueue failure count

- Source: count of backend log lines matching `Failed to enqueue inference job`
- Why it matters: queue stalls caused by Redis outages often start as enqueue failures, not worker failures
- Drill-down runbook: `docs/queue-stall-runbook.md`

### Worker processing start rate

- Source: count of worker log lines matching `Processing clip for event`
- Why it matters: backlog plus zero processing rate is the baseline stall condition
- Drill-down runbook: `docs/queue-stall-runbook.md`

## Notification Failures

### Notification failure count

- Source: count of worker log lines matching `Telegram video alert failed`, `Telegram text alert failed`, `Webhook alert failed`, `Telegram notification failed`, or `Webhook notification failed`
- Why it matters: this is the current delivery failure signal surface in the worker
- Drill-down runbook: `docs/notification-failure-runbook.md`

### Notification dispatch crash count

- Source: count of worker log lines matching `Notification dispatch crashed`
- Why it matters: it catches failures outside the channel-specific send paths
- Drill-down runbook: `docs/notification-failure-runbook.md`

### Notification success count

- Source: count of `Notification dispatch finished for event ... telegram_sent=True ...` and `... webhook_sent=True`
- Why it matters: gives a simple denominator for delivery health until richer attempt tracking lands
- Drill-down runbook: `docs/notification-failure-runbook.md`

## Saved Searches

Keep these saved searches next to the dashboard:

- Queue backlog and worker liveness: `Worker startup` and `Processing clip for event`
- Queue enqueue failures: `Failed to enqueue inference job`
- Notification failures: `Telegram video alert failed|Telegram text alert failed|Webhook alert failed|Notification dispatch crashed`

## Review Cadence

- Review queue panels after any worker or Redis change.
- Review notification panels after any Telegram or webhook configuration change.
- Update this baseline when the repo gains stable structured worker metrics beyond the current log-first surface.

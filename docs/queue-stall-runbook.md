# Queue Stall Runbook

Use this runbook when clips upload successfully but inference summaries stop arriving, backlog grows, or the worker appears idle.

## Current Signal Surface

PW-11 uses the signals that already exist in this repo today:

- Backend enqueue success: `Enqueued inference job <job_id> for event <event_id>`
- Backend enqueue failure: `Failed to enqueue inference job for event <event_id>: <error>`
- Worker startup: `Worker startup: queue=clip_uploaded level=<LEVEL> telegram_configured=<bool> webhook_configured=<bool>`
- Worker processing start: `Processing clip for event <event_id> (session <session_id>)`

Treat this as a log-first runbook. Do not invent queue metrics that are not emitted yet.

## Immediate Checks

1. Confirm local dependencies are up:

   ```bash
   ./scripts/dev-up
   docker compose -f infra/docker-compose.yml ps
   ```

2. Confirm the worker process is running:

   ```bash
   ps -eo pid,lstart,cmd | rg "app\\.cli run --queue clip_uploaded"
   ```

3. Confirm Redis shows the queue key and current depth:

   ```bash
   docker compose -f infra/docker-compose.yml exec redis redis-cli LLEN rq:queue:clip_uploaded
   ```

Interpretation:

- `0` means no queued backlog right now.
- A depth that keeps rising while there are no fresh `Processing clip for event ...` logs indicates a stall or missing worker.

## Triage Flow

1. Check backend output for enqueue failures.

   If you see `Failed to enqueue inference job ...`, fix Redis availability first. A queue stall investigation is secondary until enqueues recover.

2. Check whether the worker restarted recently enough.

   Use the `ps` command above and compare the start time to your last `./scripts/dev` restart. A stale worker is a common cause because the worker does not hot-reload.

3. Compare enqueue activity with processing activity.

   If backend logs show repeated `Enqueued inference job ...` lines but worker logs never show `Processing clip for event ...`, treat it as an active queue stall.

4. Confirm whether the worker is blocked or just behind.

   If `Processing clip for event ...` continues to appear and the Redis queue depth eventually falls, the system is slow but not stalled. Capture the queue depth and event ids, then continue monitoring.

## Backlog Response

Use this when backlog is real and user-visible.

1. Restart the local stack if the worker is missing or stale:

   ```bash
   ./scripts/dev
   ```

   If it is already running, stop it and start it again so the worker process is recreated.

2. Re-check queue depth after restart:

   ```bash
   docker compose -f infra/docker-compose.yml exec redis redis-cli LLEN rq:queue:clip_uploaded
   ```

3. Watch for recovery signals:

   - A fresh `Worker startup ...` banner
   - New `Processing clip for event ...` lines
   - Queue depth starting to drop

4. Record the first impacted event ids from backend enqueue logs so later notification or inference debugging stays scoped to the affected window.

## Exit Criteria

The incident is considered mitigated when all are true:

- `rq:queue:clip_uploaded` stops growing
- New queued events reach `Processing clip for event ...`
- Fresh event summaries start appearing again

## Follow-On Checks

- If the worker is processing clips but alerts are still missing, continue with `docs/notification-failure-runbook.md`.
- If notification logs themselves are missing, start with `docs/worker-notification-logging.md`.

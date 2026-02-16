# Worker Notification Logging Runbook

This runbook captures the known-good logging flow for alert notifications (Telegram/webhook) in local dev.

## Purpose

When inference returns `should_notify=true`, you should see worker-side notification logs.  
If those logs are missing, use this checklist before debugging inference logic.

## Required Environment

Set in `.env` (or exported in shell before `./scripts/dev`):

- `WORKER_LOG_LEVEL=INFO` (or `DEBUG`)
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` for Telegram
- `NOTIFY_WEBHOOK_URL` for webhook delivery (optional)

## Startup Verification (Critical)

The worker emits a startup banner from `worker/app/cli.py`:

`Worker startup: queue=<queue> level=<LEVEL> telegram_configured=<bool> webhook_configured=<bool>`

If you do not see this line, you are likely on an old worker process.

## Expected Log Sequence Per Alerted Event

For events where inference produces `should_notify=true`, worker logs should include:

1. `Inference result: ... notify=True`
2. `Dispatching outbound notifications for event <event_id>`
3. `Notification dispatch requested for event <event_id>: ...`
4. Channel-specific lines:
   - `Sending Telegram ...` and success/failure lines, or
   - `Sending webhook ...` and success/failure lines
5. `Notification dispatch finished for event <event_id>: telegram_sent=<bool> webhook_sent=<bool>`

If `should_notify=false`, expected line is:

- `Notification dispatch skipped for event <event_id>: should_notify=False`

## Common Gotcha: Worker Not Reloaded

`backend` uses reload in `./scripts/dev`, but `worker` does not hot-reload code.  
After changes in worker logging/notifications:

1. Stop `./scripts/dev`
2. Restart `./scripts/dev`
3. Re-run event flow

## Quick Process Check

You can confirm active worker command and start time:

```bash
ps -eo pid,lstart,cmd | rg "app\\.cli run --queue clip_uploaded"
```

If timestamp predates your latest changes/restart, you are running stale worker code.

## Notes

- API request logs (`/events/.../summary`) confirm backend writes, not notification delivery.
- Notification delivery logs are emitted by worker modules:
  - `worker/app/tasks.py`
  - `worker/app/notifications.py`

# Notification Failure Runbook

Use this runbook when inference decides an event should notify, but Telegram or webhook delivery is skipped, partially delivered, or fails.

## Start Here

First confirm that notification logs are present at all by following `docs/worker-notification-logging.md`.

If you do not see the dispatch logs listed there, stop and fix worker logging visibility first.

## Expected Success Path

For an alerted event, the normal sequence is:

1. `Inference result: ... notify=True`
2. `Dispatching outbound notifications for event <event_id>`
3. `Notification dispatch requested for event <event_id>: should_notify=True telegram_configured=<bool> webhook_configured=<bool>`
4. Channel-specific send lines
5. `Notification dispatch finished for event <event_id>: telegram_sent=<bool> webhook_sent=<bool>`

## Failure Classes

### Configuration Missing

Look for:

- `No outbound notification channels configured for event <event_id>`
- `Telegram notification skipped for event <event_id>: token_configured=<bool> chat_configured=<bool>`
- `Webhook notification skipped for event <event_id>: webhook not configured`

Actions:

- Confirm `TELEGRAM_BOT_TOKEN` is set when Telegram is expected.
- Confirm `NOTIFY_WEBHOOK_URL` is set when webhook delivery is expected.
- Restart `./scripts/dev` after changing worker environment so the worker picks up the new values.

### Telegram Target Mapping Missing

Look for:

- `No Telegram chat target resolved for event <event_id> (device=<device_id>)`
- `Telegram target lookup failed for event <event_id> (device=<device_id>, status=<status>)`
- `Telegram target response had no chat id for event <event_id> (device=<device_id>)`

Actions:

1. Verify the backend can resolve the device target:

   ```bash
   curl "http://localhost:8000/notifications/telegram/target?device_id=<device_id>"
   ```

2. If the response shows `"linked": false` or no `chat_id`, re-run the device linking flow before retrying alerts.

### Provider Rejects the Request

Look for:

- `Telegram video alert failed for event <event_id>: status=<status> body=<body>`
- `Telegram text alert failed for event <event_id>: status=<status> body=<body>`
- `Webhook alert failed for event <event_id>: status=<status> body=<body>`

Actions:

- Capture the `event_id`, HTTP status, and truncated body from the worker log.
- For Telegram, verify the bot token, chat link status, and whether `TELEGRAM_SEND_VIDEO=true` is compatible with the target chat.
- For webhook delivery, verify the receiver is up and the optional `NOTIFY_WEBHOOK_SECRET` matches what the receiver expects.

### Transport / Timeout Failure

Look for:

- `Telegram video alert request failed for event <event_id>: <error>`
- `Telegram text alert request failed for event <event_id>: <error>`
- `Webhook alert request failed for event <event_id>: <error>`
- `Notification dispatch crashed for event <event_id>: <error>`

Actions:

- Check outbound network reachability from the worker host.
- Verify `NOTIFICATION_TIMEOUT_SECONDS` is high enough for the current provider.
- Re-run the alert after the provider or network issue is cleared.

## Recovery Verification

After a fix, confirm:

- `Notification dispatch finished for event <event_id>: telegram_sent=True webhook_sent=<bool>`
- or `Notification dispatch finished for event <event_id>: telegram_sent=<bool> webhook_sent=True`

If the worker processes the clip but no dispatch logs appear, return to `docs/worker-notification-logging.md`.

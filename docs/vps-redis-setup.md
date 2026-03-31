# VPS Redis Setup

Use this runbook to install and harden the Redis instance that Ping Watch will use on the VPS for staging and production.

This is the cheapest MVP queue setup:

- Redis runs locally on the VPS
- backend and worker use `REDIS_URL=redis://127.0.0.1:6379/0`
- Redis is not exposed publicly

This document assumes Ubuntu 24.04 and the same VPS currently hosting the app behind `nginx` and `systemd`.

## Why Local Redis

For Ping Watch today, Redis is only used as the queue backend for RQ.

Keeping it on the VPS:

- avoids Azure Managed Redis cost
- avoids the Azure zone/subscription blocker you hit
- keeps queue latency low because backend and worker are on the same machine

Move Redis off the VPS later only if queue load or reliability needs outgrow this setup.

## Install Redis

```bash
sudo apt-get update
sudo apt-get install -y redis-server
```

Confirm the package installed:

```bash
redis-server --version
```

## Configure Redis For Local-Only Access

Open the Redis config:

```bash
sudo editor /etc/redis/redis.conf
```

Make sure these settings are present:

```conf
bind 127.0.0.1 ::1
protected-mode yes
port 6379
daemonize no
supervised systemd
appendonly no
```

Notes:

- `bind 127.0.0.1 ::1` keeps Redis reachable only from the VPS itself.
- `protected-mode yes` adds a second layer of safety.
- `appendonly no` keeps disk churn and cost low for this MVP queue use case.
- default RDB snapshots are acceptable for now because Redis is a transient queue, not the source of truth.

## Enable And Start Redis

```bash
sudo systemctl enable redis-server
sudo systemctl restart redis-server
```

Check service health:

```bash
sudo systemctl status redis-server --no-pager
```

## Verify Local Access Only

From the VPS:

```bash
redis-cli -h 127.0.0.1 ping
```

Expected result:

```text
PONG
```

Optional socket check:

```bash
sudo ss -ltnp | grep 6379
```

Expected result:

- Redis should be listening on `127.0.0.1:6379`
- Redis should not be listening on `0.0.0.0:6379`

## Map Redis Into Ping Watch

Set this in both VPS runtime files:

```bash
REDIS_URL=redis://127.0.0.1:6379/0
```

Files:

- `/etc/ping-watch/staging.env`
- `/etc/ping-watch/production.env`

After updating the env files:

```bash
sudo systemctl restart ping-watch-backend@staging ping-watch-worker@staging
sudo systemctl restart ping-watch-backend@production ping-watch-worker@production
```

Restart only the environment you are actively deploying if production is not live yet.

## Quick Queue Verification

Once backend and worker are running:

```bash
redis-cli -h 127.0.0.1 LLEN rq:queue:clip_uploaded
```

Expected result:

- `0` when idle
- a small positive number briefly when jobs are queued

## Optional Hardening

For this MVP, do these only if needed:

- add `maxmemory` and `maxmemory-policy noeviction` after you measure memory use
- add basic monitoring with `INFO memory` and `INFO stats`
- add a local firewall rule if you later change the bind address

Do not expose Redis directly to the internet.

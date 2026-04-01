# Domain Routing And TLS Plan

This document defines the recommended domain and nginx/TLS shape for the shared VPS that hosts:

- the public website from `../website`
- the Ping Watch app from this repository

It is written for the current path-based hosting model and can be applied once the domain DNS is ready.

## Recommended Public Route Layout

Keep one public domain and one nginx server block for now.

Recommended path ownership:

- `/mohamad`
  owned by the `../website` repo
- `/ping-watch-dev`
  owned by this repo, hosted `dev`
- `/ping-watch-staging`
  owned by this repo, hosted `staging`
- `/ping-watch`
  owned by this repo, hosted `production`

Recommended API routes:

- `/ping-watch-api-dev`
- `/ping-watch-api-staging`
- `/ping-watch-api`

## Why Keep Path-Based Routing For Now

This is the lowest-risk next step because:

- the website is already mounted under `/mohamad`
- the VPS already uses one nginx site file
- Ping Watch already supports path-based frontend builds
- it avoids introducing multiple subdomains and extra DNS/certificate coordination immediately

Once the product is more mature, we can still move Ping Watch to a dedicated subdomain.

## Domain Recommendation

Short term:

- point the purchased domain to the VPS
- serve both repos through one HTTPS-enabled nginx site
- keep Ping Watch path-based

Suggested user-facing behavior:

- `/`
  either redirect to `/mohamad` or serve the public website landing page, depending on what you want the root to be
- `/mohamad`
  public website
- `/ping-watch`
  Ping Watch production app

## nginx Ownership Model

For now, treat the website repo as the owner of the top-level nginx site file because it already owns the shared server block.

Recommended split:

- `../website`
  owns `/etc/nginx/sites-available/maah`
- `ping-watch`
  owns `/etc/nginx/snippets/ping-watch-locations.conf`

That means:

- the website repo defines the server block, domain names, TLS certificates, and root redirect behavior
- this repo continues to define only the Ping Watch location snippets

## TLS Plan

Use Certbot with nginx once DNS resolves to the VPS.

High-level rollout:

1. Point DNS `A` record to the VPS IPv4 address.
2. Wait until the domain resolves publicly.
3. Update the nginx `server_name` in the shared website-owned site file.
4. Validate nginx on plain HTTP first.
5. Run Certbot with nginx integration.
6. Confirm HTTP redirects to HTTPS.
7. Re-test all shared routes.

## Shared nginx Shape

Recommended HTTP/HTTPS behavior:

- HTTP:
  allow ACME challenge and redirect all application traffic to HTTPS
- HTTPS:
  serve `/mohamad`
  include Ping Watch nginx snippet for `/ping-watch*`

Conceptually:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name example.com www.example.com;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name example.com www.example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    include /etc/nginx/snippets/ping-watch-locations.conf;

    location = / {
        return 302 /mohamad;
    }

    location = /mohamad {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location = /mohamad/ {
        return 308 /mohamad;
    }

    location ^~ /mohamad/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    location / {
        return 404;
    }
}
```

The exact top-level file should still live in the website repo, but this is the shared target shape.

## Certbot Commands

After nginx is serving the real domain on port 80:

```bash
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx
sudo nginx -t
sudo certbot --nginx -d your-domain.example -d www.your-domain.example
```

Then verify renewal:

```bash
sudo certbot renew --dry-run
```

## Ping Watch Environment Values After Domain Cutover

Update:

- `BACKEND_CORS_ORIGINS`
- `PING_WATCH_PUBLIC_ORIGIN`
- GitHub environment secret `PUBLIC_ORIGIN`

Expected examples:

- `dev`: `https://your-domain.example`
- `staging`: `https://your-domain.example`
- `production`: `https://your-domain.example`

The path segment differentiates the environments; the origin stays the same.

## Verification Checklist

After enabling TLS, verify:

```bash
curl -I http://your-domain.example/mohamad
curl -I https://your-domain.example/mohamad
curl -I https://your-domain.example/ping-watch-dev
curl -I https://your-domain.example/ping-watch-staging
curl -I https://your-domain.example/ping-watch
curl -I https://your-domain.example/ping-watch-api-dev/docs
curl -I https://your-domain.example/ping-watch-api-staging/docs
curl -I https://your-domain.example/ping-watch-api/docs
```

Also verify in real browsers:

- camera preview on HTTPS
- clipboard copy on HTTPS
- Telegram invite flow on HTTPS
- PWA installability on production path

## Later Upgrade Path

If path-based hosting becomes limiting, move Ping Watch to subdomains later:

- `app.<domain>` or `ping-watch.<domain>` for production
- `staging.<domain>` for staging

But do not block the current rollout on that change.

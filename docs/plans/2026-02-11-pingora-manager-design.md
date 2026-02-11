# Pingora Manager — Design Document

Full-featured web-based management UI for Cloudflare Pingora reverse proxy. Analog of Nginx Proxy Manager, built for performance.

## Architecture

Single Docker container. Pingora is the main process (PID 1), the web admin panel runs as a daemon managed by s6-overlay. Pingora proxies the admin UI on port 81. If the admin process crashes, s6 restarts it automatically; Pingora continues serving traffic.

```
pingora-manager (single container)
├── Pingora (Rust)       — ports 80, 443, proxies :81 → Bun :3001
├── Web Admin (Bun)      — Remix app + watchdog background worker
├── s6-overlay           — process supervisor
└── SQLite               — data/db.sqlite
```

### Docker Compose

```yaml
services:
  pingora-manager:
    image: 'hardskilled/pingora-manager:latest'
    restart: unless-stopped
    ports:
      - '80:80'
      - '81:81'
      - '443:443'
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
      - /path/to/static:/var/static
```

### Data Directory (mounted volume)

```
data/
├── db.sqlite
├── configs/
│   ├── global.yaml
│   ├── host-*.yaml
│   ├── redirect-*.yaml
│   ├── stream-*.yaml
│   └── access-lists.yaml
├── logs/
│   ├── host-{id}_access.log
│   └── host-{id}_error.log
├── error-pages/
│   ├── global/
│   ├── group-{id}/
│   └── host-{id}/
├── default-page/
│   └── index.html
└── ssl/
    └── custom/
```

### Config Reload Flow

1. Admin UI saves changes to SQLite
2. Generates YAML config files to `data/configs/`
3. Writes error page HTML files to `data/error-pages/`
4. Sends SIGHUP to Pingora via s6 (`s6-svc -h /run/s6/services/pingora`)
5. Pingora gracefully reloads — no downtime
6. Audit log entry created

---

## Data Model (SQLite + Drizzle ORM)

### users

| Column     | Type    | Notes                          |
|------------|---------|--------------------------------|
| id         | INTEGER | PRIMARY KEY                    |
| email      | TEXT    | UNIQUE NOT NULL                |
| password   | TEXT    | NOT NULL, Argon2id hash        |
| name       | TEXT    | NOT NULL                       |
| role       | TEXT    | DEFAULT 'viewer' — admin/editor/viewer |
| created_at | INTEGER | unix timestamp                 |
| updated_at | INTEGER |                                |

### host_groups

| Column      | Type    | Notes              |
|-------------|---------|--------------------|
| id          | INTEGER | PRIMARY KEY        |
| name        | TEXT    | NOT NULL           |
| description | TEXT    |                    |
| webhook_url | TEXT    | group-level webhook |
| created_at  | INTEGER |                    |

### proxy_hosts

| Column          | Type    | Notes                                    |
|-----------------|---------|------------------------------------------|
| id              | INTEGER | PRIMARY KEY                              |
| group_id        | INTEGER | FK → host_groups                         |
| domains         | TEXT    | JSON: ["devkg.com", "www.devkg.com"]     |
| ssl_type        | TEXT    | DEFAULT 'none' — letsencrypt/custom/none |
| ssl_force_https | INTEGER | DEFAULT 0                                |
| ssl_cert_path   | TEXT    |                                          |
| ssl_key_path    | TEXT    |                                          |
| upstreams       | TEXT    | JSON: [{"server":"x","port":3000,"weight":5}] |
| balance_method  | TEXT    | DEFAULT 'round_robin'                    |
| locations       | TEXT    | JSON: array of location objects          |
| hsts            | INTEGER | DEFAULT 1                                |
| http2           | INTEGER | DEFAULT 1                                |
| webhook_url     | TEXT    | host-level webhook                       |
| enabled         | INTEGER | DEFAULT 1                                |
| created_at      | INTEGER |                                          |
| updated_at      | INTEGER |                                          |

**Location object structure:**
```json
{
  "path": "/api",
  "matchType": "prefix",
  "type": "proxy",
  "upstreams": [{"server": "api-backend", "port": 3000, "weight": 1}],
  "headers": {"X-Real-IP": "$remote_addr"},
  "accessListId": 1,
  "basicAuth": {"enabled": true, "realm": "Restricted"},
  "cacheEnabled": false
}
```

**Static location:**
```json
{
  "path": "/images",
  "matchType": "prefix",
  "type": "static",
  "staticDir": "/var/static/images",
  "cacheExpires": "30d"
}
```

### redirections

| Column         | Type    | Notes                        |
|----------------|---------|------------------------------|
| id             | INTEGER | PRIMARY KEY                  |
| group_id       | INTEGER | FK → host_groups             |
| domains        | TEXT    | JSON: ["old.example.com"]    |
| forward_scheme | TEXT    | DEFAULT 'https'              |
| forward_domain | TEXT    | NOT NULL                     |
| forward_path   | TEXT    | DEFAULT '/'                  |
| preserve_path  | INTEGER | DEFAULT 1                    |
| status_code    | INTEGER | DEFAULT 301 — 301/302        |
| ssl_type       | TEXT    | DEFAULT 'none'               |
| enabled        | INTEGER | DEFAULT 1                    |
| created_at     | INTEGER |                              |

### streams

| Column        | Type    | Notes                                    |
|---------------|---------|------------------------------------------|
| id            | INTEGER | PRIMARY KEY                              |
| group_id      | INTEGER | FK → host_groups                         |
| incoming_port | INTEGER | NOT NULL                                 |
| protocol      | TEXT    | DEFAULT 'tcp' — tcp/udp                  |
| upstreams     | TEXT    | JSON: [{"server":"db","port":5432,"weight":1}] |
| balance_method| TEXT    | DEFAULT 'round_robin'                    |
| webhook_url   | TEXT    |                                          |
| enabled       | INTEGER | DEFAULT 1                                |
| created_at    | INTEGER |                                          |

### access_lists

| Column     | Type    | Notes                    |
|------------|---------|--------------------------|
| id         | INTEGER | PRIMARY KEY              |
| name       | TEXT    | NOT NULL                 |
| satisfy    | TEXT    | DEFAULT 'any' — any/all  |
| created_at | INTEGER |                          |

### access_list_clients

| Column         | Type    | Notes                              |
|----------------|---------|------------------------------------|
| id             | INTEGER | PRIMARY KEY                        |
| access_list_id | INTEGER | FK → access_lists                  |
| address        | TEXT    | NOT NULL — IP or CIDR              |
| directive      | TEXT    | DEFAULT 'allow' — allow/deny       |

### access_list_auth

| Column         | Type    | Notes                         |
|----------------|---------|-------------------------------|
| id             | INTEGER | PRIMARY KEY                   |
| access_list_id | INTEGER | FK → access_lists             |
| username       | TEXT    | NOT NULL                      |
| password       | TEXT    | NOT NULL — htpasswd hash      |

### health_checks

| Column      | Type    | Notes                     |
|-------------|---------|---------------------------|
| id          | INTEGER | PRIMARY KEY               |
| host_id     | INTEGER |                           |
| upstream    | TEXT    | NOT NULL — "backend:3000" |
| status      | TEXT    | NOT NULL — up/down        |
| response_ms | INTEGER |                           |
| checked_at  | INTEGER | unix timestamp            |

Index: `(host_id, checked_at)`. Auto-cleanup: records older than 30 days.

### audit_log

| Column     | Type    | Notes                                    |
|------------|---------|------------------------------------------|
| id         | INTEGER | PRIMARY KEY                              |
| user_id    | INTEGER | FK → users                               |
| action     | TEXT    | NOT NULL — create/update/delete/login/reload |
| entity     | TEXT    | NOT NULL — proxy_host/group/user/ssl/... |
| entity_id  | INTEGER |                                          |
| details    | TEXT    | JSON: what changed                       |
| ip_address | TEXT    |                                          |
| created_at | INTEGER |                                          |

Auto-cleanup: records older than 90 days (configurable).

### settings

| Column | Type | Notes               |
|--------|------|---------------------|
| key    | TEXT | PRIMARY KEY         |
| value  | TEXT | JSON or string      |

Keys: `default_page_html`, `global_webhook_url`, `watchdog_interval_ms`.

---

## Pingora Proxy Server (Rust)

### Responsibilities

- Reverse proxy: HTTP/HTTPS traffic routing by domain + location
- Load balancing: Round Robin, Weighted, Least Connections, IP Hash, Random
- Static file serving with cache headers (Cache-Control, Expires)
- SSL termination: Let's Encrypt + custom certificates
- TCP/UDP stream proxying
- Error page serving: host → group → global → built-in fallback
- Default page serving for unconfigured domains
- Access control: IP whitelist/blacklist + Basic Auth
- HTTP redirections
- Proxying admin UI: port 81 → Bun on 127.0.0.1:3001
- Logging: per-host access and error logs
- Graceful hot-reload on SIGHUP

### Config Format (YAML)

**global.yaml:**
```yaml
listen:
  http: 80
  https: 443
  admin: 81
admin_upstream: "127.0.0.1:3001"
default_page: /data/default-page/index.html
error_pages_dir: /data/error-pages
logs_dir: /data/logs
ssl_dir: /etc/letsencrypt
```

**host-{id}.yaml:**
```yaml
id: 1
domains:
  - devkg.com
  - www.devkg.com
group_id: 1
ssl:
  type: letsencrypt
  force_https: true
upstreams:
  - server: devkg-frontend-prod
    port: 8000
    weight: 5
  - server: devkg-frontend-prod-2
    port: 8000
    weight: 3
balance_method: weighted
locations:
  - path: /api
    match_type: prefix
    upstreams:
      - server: devkg-backend-prod
        port: 3000
    access_list_id: 1
    basic_auth:
      realm: "Restricted Content"
  - path: "/(fb|tg|vk)/[ejm]-([0-9]+)"
    match_type: regex
    upstreams:
      - server: devkg-backend-prod
        port: 3000
  - path: /images
    match_type: prefix
    static_dir: /var/static/devkg/images
    cache_expires: 30d
  - path: /rss
    match_type: prefix
    static_dir: /var/static/devkg/rss
    cache_expires: 10m
  - path: /
    match_type: prefix
hsts: true
http2: true
enabled: true
```

### Rust Crates

- `pingora`, `pingora-proxy`, `pingora-load-balancing` — core proxy
- `serde` + `serde_yaml` — YAML parsing
- `tokio` — async runtime
- `rustls` — TLS
- `nix` — SIGHUP handling

---

## Web Admin (Remix + Bun)

### Tech Stack

- Remix (React Router v7) — fullstack framework
- Zustand — state management
- Tailwind CSS — styling
- better-sqlite3 — SQLite driver
- Drizzle ORM — database ORM
- Argon2 (`argon2` package) — password hashing
- jose — JWT tokens
- CodeMirror — HTML editor for error pages / default page
- yaml — YAML config generation
- acme-client — Let's Encrypt ACME protocol

### UI Sections

1. **Dashboard** — host count, up/down service status, recent events
2. **Proxy Hosts** — CRUD with tabbed form (General, Upstreams, Locations, SSL, Advanced)
3. **Groups** — manage host groups, group-level webhook
4. **Redirections** — domain-to-domain redirects with 301/302, preserve path option
5. **Streams (TCP/UDP)** — TCP/UDP proxy management
6. **SSL Certificates** — Let's Encrypt requests, custom cert upload, expiry status
7. **Access Lists** — reusable IP + Basic Auth rules
8. **Error Pages** — HTML editor (CodeMirror) per error code, scoped: global/group/host
9. **Default Page** — HTML editor for unconfigured domain responses
10. **Static Directories** — path-to-directory mappings with cache settings
11. **Logs** — per-host access/error logs, tail mode, search, filter, download
12. **Health Dashboard** — upstream status table, response times, uptime graphs (24h/7d)
13. **Audit Log** — chronological action log, filter by user/action/entity/date
14. **Users** — CRUD users, role assignment
15. **Settings** — global webhook URL, watchdog interval, log rotation, audit cleanup period

### Proxy Host Form (tabs)

**General:** domains (multi-input chips), group (select), enabled (toggle)

**Upstreams:** list of server + port + weight, "Add upstream" button, balance method select

**Locations:** sortable list (drag & drop), each with: path + match type (prefix/exact/regex), type (proxy/static), upstreams or static dir + cache expires, access list select, custom headers (key/value)

**SSL:** type (None/Let's Encrypt/Custom), Force HTTPS toggle, HTTP/2 toggle, HSTS toggle

**Advanced:** webhook URL, custom Pingora directives (raw YAML textarea)

### Authentication & Authorization

JWT in httpOnly secure cookie, 24h expiry.

| Action                          | admin | editor | viewer |
|---------------------------------|-------|--------|--------|
| View hosts, logs, dashboard     | +     | +      | +      |
| CRUD hosts, groups, redirects   | +     | +      | -      |
| Manage SSL, access lists        | +     | +      | -      |
| Edit error pages, default page  | +     | +      | -      |
| Manage static directories       | +     | +      | -      |
| Reload Pingora                  | +     | +      | -      |
| View audit log                  | +     | +      | +      |
| CRUD users                      | +     | -      | -      |
| Change settings                 | +     | -      | -      |

**First run:** initial admin account `admin@example.com` / `changeme`, forced password change on first login.

### Watchdog (Background Worker)

Runs as `setInterval` inside Bun process. Every N seconds (default 30s, configurable):

1. Iterates all enabled proxy hosts and streams
2. TCP connect (or HTTP ping) each upstream
3. Records result in `health_checks` table
4. On status change (up→down or down→up), sends webhook notification

**Webhook URL resolution order:** host → group → global (first found wins).

**Webhook payload:**
```json
{
  "event": "upstream_down",
  "host": "devkg.com",
  "upstream": "devkg-frontend-prod:8000",
  "group": "Production",
  "timestamp": "2026-02-11T15:30:00Z",
  "response_ms": null,
  "message": "Connection refused"
}
```

---

## SSL Management

### Let's Encrypt

- HTTP-01 challenge: Pingora serves `/.well-known/acme-challenge/` responses (requires port 80)
- DNS-01 challenge: for wildcard certs, requires DNS provider API key
- Auto-renewal: watchdog checks every 12 hours, renews if expiring within 30 days
- Certificates stored in `/etc/letsencrypt/`
- Webhook notification when cert is expiring soon (30 days)

### Custom Certificates

- Upload .crt + .key via UI
- Stored in `data/ssl/custom/`
- Validation on upload: cert/key match, not expired

---

## Error Pages

Stored as HTML files on disk. Edited through CodeMirror HTML editor in admin UI.

```
data/error-pages/
├── global/
│   ├── 404.html
│   ├── 502.html
│   └── 503.html
├── group-{id}/
│   └── 502.html
└── host-{id}/
    └── 502.html
```

Resolution order: `host-{id}/` → `group-{id}/` → `global/` → built-in default.

---

## Project Structure

```
pingora-manager/
├── proxy/
│   ├── src/
│   │   ├── main.rs
│   │   ├── config.rs
│   │   ├── router.rs
│   │   ├── upstream.rs
│   │   ├── static_files.rs
│   │   ├── error_pages.rs
│   │   ├── access_control.rs
│   │   ├── ssl.rs
│   │   └── streams.rs
│   ├── Cargo.toml
│   └── Cargo.lock
├── web/
│   ├── app/
│   │   ├── routes/
│   │   ├── components/
│   │   ├── lib/
│   │   │   ├── db/
│   │   │   ├── auth/
│   │   │   ├── config-generator/
│   │   │   ├── watchdog/
│   │   │   ├── acme/
│   │   │   └── signal/
│   │   └── store/
│   ├── package.json
│   └── bun.lock
├── Dockerfile
├── docker-compose.yml
├── s6/
└── docs/
    └── plans/
```

### Dockerfile (multi-stage)

1. **Stage: build-proxy** — Rust builder, compiles Pingora server
2. **Stage: build-web** — Bun builder, builds Remix app
3. **Stage: runtime** — Debian slim + s6-overlay, copies binaries and built app

---

## Log Management

- Per-host access and error logs in `data/logs/`
- Rotation via logrotate (built into container) — by size or date, configurable in Settings
- UI: tail mode with auto-refresh, filter by status code/IP/path/date, text search, file download

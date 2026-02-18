# Pingora Manager (Experimental)

A high-performance reverse proxy management system built on [Cloudflare's Pingora](https://github.com/cloudflare/pingora) framework, with a modern web-based admin UI.

Similar to Nginx Proxy Manager, but powered by Pingora — a battle-tested proxy engine written in Rust that handles over 40 million requests per second at Cloudflare.

## Features

- **Unified Hosts Management** — Manage proxy, static, redirect, and stream hosts from a single page with type selector, grouped views, color labels, and fuzzy search
- **HTTP/HTTPS Reverse Proxy** — Domain-based routing with SNI, path matching (prefix, exact, regex), and custom headers
- **SSL/TLS** — Let's Encrypt (ACME HTTP-01), custom certificates, force HTTPS, HSTS
- **Load Balancing** — Round robin, weighted, least connections, IP hash, random
- **Access Control** — IP allowlist/denylist (CIDR), Basic Auth, per-host or per-location rules with satisfy any/all logic
- **Static File Serving** — In-memory caching, MIME detection, Cache-Control headers, conditional requests (304)
- **TCP/UDP Stream Proxying** — Forward arbitrary TCP/UDP traffic with load balancing
- **HTTP Redirections** — Configurable status codes (301/302/307/308), path preservation
- **Custom Error Pages** — Per-host, per-group, or global HTML error pages with cascading fallback
- **Health Checks** — Periodic upstream monitoring with webhook notifications
- **Zero-Downtime Config Reload** — Lock-free state management via `ArcSwap`, triggered by SIGHUP
- **Audit Logging** — Tracks all configuration changes with user, action, and timestamp
- **Web Admin UI** — Full CRUD management for all resources, built with React and Tailwind CSS

## Quick Start

### Docker (recommended)

```bash
docker compose up -d
```

The admin UI will be available at [http://localhost:81](http://localhost:81).

Default credentials:

| Email | Password |
|-------|----------|
| `admin@example.com` | `changeme` |

### Docker Compose

```yaml
services:
  pingora-manager:
    image: hardskilled/pingora-manager:latest
    restart: unless-stopped
    ports:
      - '80:80'     # HTTP
      - '81:81'     # Admin UI
      - '443:443'   # HTTPS
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Docker Container                   │
│                   (s6-overlay init)                   │
│                                                      │
│  ┌─────────────────────┐  ┌───────────────────────┐  │
│  │   Pingora Proxy     │  │    Web Admin (Bun)    │  │
│  │      (Rust)         │  │   React Router + API  │  │
│  │                     │  │                       │  │
│  │  :80  HTTP          │  │  :3001 (internal)     │  │
│  │  :443 HTTPS         │  │                       │  │
│  │  :81  Admin ────────┼──┤                       │  │
│  └──────────┬──────────┘  └───────────┬───────────┘  │
│             │                         │              │
│             │    ┌────────────┐       │              │
│             └────┤ YAML Configs├──────┘              │
│                  └──────┬─────┘                      │
│                         │                            │
│                  ┌──────┴─────┐                      │
│                  │  SQLite DB  │                      │
│                  └────────────┘                       │
└──────────────────────────────────────────────────────┘
```

**How it works:**

1. The **Web Admin** UI stores configuration in a SQLite database
2. On every change, it generates YAML config files and sends SIGHUP to the proxy
3. The **Pingora Proxy** reloads configuration from YAML files with zero downtime (lock-free `ArcSwap`)
4. Port 81 is proxied by Pingora itself to the internal web admin on port 3001

## Ports

| Port | Purpose |
|------|---------|
| 80 | HTTP proxy |
| 443 | HTTPS proxy |
| 81 | Admin UI |

## Volumes

| Path | Purpose |
|------|---------|
| `/data` | SQLite database, YAML configs, logs, error pages, static files |
| `/etc/letsencrypt` | Let's Encrypt certificates |

### Data Directory Structure

```
/data/
├── db.sqlite              # Application database
├── configs/               # Generated YAML configs (auto-managed)
│   ├── global.yaml
│   ├── host-{id}.yaml
│   ├── redirect-{id}.yaml
│   ├── stream-{id}.yaml
│   └── access-lists.yaml
├── logs/                  # Proxy access logs
├── error-pages/           # Custom error page HTML files
│   ├── global/            # Global error pages (404.html, 502.html, etc.)
│   └── host-{id}/         # Per-host error pages
├── default-page/          # Default page for unconfigured domains
├── ssl/custom/            # Custom SSL certificates
└── acme-challenge/        # ACME HTTP-01 challenge tokens
```

## Admin UI Pages

| Page | Description |
|------|-------------|
| **Dashboard** | Overview of all host types, groups, and upstream health |
| **Hosts** | Unified management of proxy, static, redirect, and stream hosts — with group/flat view toggle, color labels, and fuzzy search |
| **SSL Certificates** | Manage Let's Encrypt and custom certificates |
| **Access Lists** | IP-based and Basic Auth access control rules |
| **Error Pages** | Upload custom HTML error pages |
| **Default Page** | Edit the page shown for unconfigured domains |
| **Logs** | View proxy access logs |
| **Health** | Monitor upstream server health |
| **Audit Log** | Track configuration changes |
| **Users** | Manage admin accounts (admin, editor, viewer roles) |
| **Settings** | Global settings and webhook configuration |

## Configuration

All configuration is managed through the admin UI. The web application generates YAML config files that the Pingora proxy reads.

### Proxy Host Example

A proxy host configuration (generated YAML):

```yaml
id: 1
domains:
  - example.com
  - www.example.com
ssl:
  type: letsencrypt
  force_https: true
upstreams:
  - server: 192.168.1.10
    port: 8080
    weight: 1
  - server: 192.168.1.11
    port: 8080
    weight: 1
balance_method: round_robin
locations:
  - path: /api
    matchType: prefix
    type: proxy
    upstreams:
      - server: 192.168.1.20
        port: 3000
        weight: 1
  - path: /static
    matchType: prefix
    type: static
    staticDir: /data/static/example
    cacheExpires: 30d
hsts: true
http2: true
enabled: true
```

### Static Host Example

```yaml
id: 2
domains:
  - static.example.com
ssl:
  type: none
  force_https: false
upstreams: []
balance_method: round_robin
locations:
  - path: /
    matchType: prefix
    type: static
    staticDir: /data/static/mysite
    cacheExpires: 30d
hsts: false
http2: true
enabled: true
```

### Redirect Example

```yaml
id: 1
domains:
  - old-domain.com
forward_scheme: https
forward_domain: new-domain.com
forward_path: /
preserve_path: true
status_code: 301
enabled: true
```

### Stream Example

```yaml
id: 1
incoming_port: 3306
protocol: tcp
upstreams:
  - server: 192.168.1.50
    port: 3306
    weight: 1
balance_method: round_robin
enabled: true
```

### Access List Example

```yaml
- id: 1
  name: Office Only
  satisfy: all
  clients:
    - address: 10.0.0.0/8
      directive: allow
    - address: 0.0.0.0/0
      directive: deny
  auth:
    - username: admin
      password: $2b$12$...
```

## SSL/TLS

### Let's Encrypt

1. Create a proxy host with one or more domains
2. Set SSL type to **Let's Encrypt**
3. The system will automatically:
   - Serve ACME HTTP-01 challenges via `/.well-known/acme-challenge/`
   - Obtain and store certificates in `/etc/letsencrypt/live/{domain}/`
   - Enable HTTPS on the proxy host

**Requirements:** Port 80 must be publicly accessible for HTTP-01 validation.

### Custom Certificates

1. Upload certificate and key files via the admin UI
2. Files are stored in `/data/ssl/custom/`
3. Set SSL type to **Custom** and the paths will be configured automatically

## Load Balancing

| Method | Description |
|--------|-------------|
| `round_robin` | Distribute requests evenly across upstreams |
| `weighted` | Distribute based on upstream weight values |
| `least_conn` | Send to the upstream with fewest active connections |
| `ip_hash` | Sticky sessions based on client IP |
| `random` | Random upstream selection |

Load balancing is available for proxy hosts, per-location overrides, and TCP/UDP streams.

## Access Control

Access lists can be attached to proxy hosts or individual locations. Each list supports:

- **IP Rules** — Allow or deny by IP address or CIDR range (IPv4 and IPv6)
- **Basic Auth** — Username/password authentication
- **Satisfy** — `any` (IP match OR auth) or `all` (IP match AND auth)

## Health Checks

The watchdog service periodically checks upstream servers and:

- Records response time and status (up/down)
- Sends webhook notifications when status changes
- Supports per-host and global webhook URLs

## Development

### Prerequisites

- Rust 1.82+
- Bun 1.x

### Proxy (Rust)

```bash
cd proxy
cargo build
cargo test
cargo run
```

### Web Admin (TypeScript)

```bash
cd web
bun install
bun run dev          # Development server
bun run build        # Production build
bun run test         # Run tests
bun run test:watch   # Watch mode
```

### Building the Docker Image

```bash
docker build -t pingora-manager .
```

## Tech Stack

### Proxy
- [Pingora](https://github.com/cloudflare/pingora) 0.7 — Cloudflare's Rust proxy framework
- `arc-swap` — Lock-free concurrent state access
- `tokio` — Async runtime
- `serde_yaml` — Configuration parsing

### Web Admin
- [React](https://react.dev) 19 + [React Router](https://reactrouter.com) 7
- [Tailwind CSS](https://tailwindcss.com) 4
- [Drizzle ORM](https://orm.drizzle.team) + SQLite
- [Bun](https://bun.sh) runtime
- [Jose](https://github.com/panva/jose) — JWT authentication
- [Fuse.js](https://www.fusejs.io) — Client-side fuzzy search

### Infrastructure
- [s6-overlay](https://github.com/just-containers/s6-overlay) — Process supervisor
- Multi-stage Docker build (Rust + Bun + Debian slim)

## License

MIT

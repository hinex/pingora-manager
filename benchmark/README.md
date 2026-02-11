# Reverse Proxy Benchmark Suite

Comparison of **Pingora Manager** against popular reverse proxies:
nginx, OpenResty, Caddy, Envoy, HAProxy, OpenLiteSpeed.

## Quick Start

```bash
cd benchmark
bash scripts/run.sh
```

Results will be saved to `results/report.md`.

## Architecture

```
[wrk2] ──► [proxy :8080] ──► [backend (Bun) :3000]
```

- **One shared backend** — all proxies forward to the same Bun HTTP server
- **Equal resource limits** — every proxy gets the same CPU and memory
- **Sequential testing** — one proxy benchmarked at a time for fair comparison
- **wrk2** — coordinated omission aware latency measurement

## Scenarios

| Scenario | Endpoint | Description |
|----------|----------|-------------|
| GET | `/api/data` | JSON response with `Math.random()` |
| POST | `/api/data` | JSON body + random response |
| PUT | `/api/data` | JSON body + random response |
| DELETE | `/api/data` | Random JSON response |
| Static | `/static/mountain.jpg` | Image served directly by proxy* |
| Random Query | `/api/data?<rand>=<rand>` | Cache-busting random query params |

\* nginx, OpenResty, Caddy, OpenLiteSpeed, and Pingora serve static files from a mounted directory. Envoy and HAProxy proxy static requests to the backend.

## Configuration

Environment variables (set before running):

| Variable | Default | Description |
|----------|---------|-------------|
| `BENCH_DURATION` | `30s` | Duration per test |
| `BENCH_THREADS` | `4` | wrk2 threads |
| `BENCH_CONNECTIONS` | `100` | Concurrent connections |
| `BENCH_RATE` | `1000` | Target requests/sec |
| `BENCH_CPUS` | `1.0` | CPU limit per proxy container |
| `BENCH_MEMORY` | `256M` | Memory limit per proxy container |

Example:

```bash
BENCH_DURATION=60s BENCH_RATE=5000 bash scripts/run.sh
```

## Requirements

- Docker Engine 20.10+
- Docker Compose v2+
- curl (for image download)

## Static Image

The benchmark uses a mountain photo from [Unsplash](https://unsplash.com/photos/NVUxS1SFhKE) for static file serving tests. The image is downloaded automatically on first run. [Unsplash License](https://unsplash.com/license) — free to use.

## Proxies Compared

| Proxy | Image | Static Files |
|-------|-------|-------------|
| nginx | `nginx:alpine` | Direct from disk |
| OpenResty | `openresty/openresty:alpine` | Direct from disk |
| Caddy | `caddy:alpine` | Direct from disk |
| Envoy | `envoyproxy/envoy:v1.31-latest` | Via backend proxy |
| HAProxy | `haproxy:alpine` | Via backend proxy |
| OpenLiteSpeed | `litespeedtech/openlitespeed:latest` | Direct from disk |
| Pingora | Built from source | Direct from disk |

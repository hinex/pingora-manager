#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"

# Configurable parameters
export BENCH_DURATION="${BENCH_DURATION:-30s}"
export BENCH_THREADS="${BENCH_THREADS:-4}"
export BENCH_CONNECTIONS="${BENCH_CONNECTIONS:-100}"
export BENCH_RATE="${BENCH_RATE:-1000}"
export BENCH_CPUS="${BENCH_CPUS:-1.0}"
export BENCH_MEMORY="${BENCH_MEMORY:-256M}"

PROXIES="nginx openresty caddy envoy haproxy openlitespeed pingora"
SCENARIOS="get post put delete static random-query"

echo "═══════════════════════════════════════════════════════"
echo "  Pingora Manager — Reverse Proxy Benchmark Suite"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Duration:    $BENCH_DURATION per test"
echo "  Threads:     $BENCH_THREADS"
echo "  Connections: $BENCH_CONNECTIONS"
echo "  Target rate: $BENCH_RATE req/s"
echo "  CPU limit:   $BENCH_CPUS per proxy"
echo "  Memory:      $BENCH_MEMORY per proxy"
echo ""

# Step 1: Download static image if missing
echo "[1/6] Checking static assets..."
bash "$SCRIPT_DIR/download-image.sh"

# Step 2: Build and start all services
echo ""
echo "[2/6] Building and starting services..."
cd "$BENCH_DIR"
docker compose build
docker compose up -d

# Step 3: Wait for all proxies to be ready
echo ""
echo "[3/6] Waiting for proxies to be ready..."
for proxy in $PROXIES; do
  printf "  Waiting for %-15s" "$proxy..."
  retries=0
  until docker compose exec -T wrk curl -sf "http://${proxy}:8080/api/data" > /dev/null 2>&1; do
    retries=$((retries + 1))
    if [ $retries -gt 60 ]; then
      echo " TIMEOUT (skipping)"
      continue 2
    fi
    sleep 1
  done
  echo " ready"
done

# Step 4: Warmup
echo ""
echo "[4/6] Warming up proxies..."
for proxy in $PROXIES; do
  echo "  Warming up $proxy..."
  docker compose exec -T wrk hey -n 500 -c 10 -z 5s "http://${proxy}:8080/api/data" > /dev/null 2>&1 || true
done

# Step 5: Run benchmarks
echo ""
echo "[5/6] Running benchmarks..."
mkdir -p results/raw

for scenario in $SCENARIOS; do
  echo ""
  echo "── Scenario: $scenario ──"
  for proxy in $PROXIES; do
    bash "$SCRIPT_DIR/benchmark.sh" "$proxy" "$scenario" \
      "$BENCH_DURATION" "$BENCH_THREADS" "$BENCH_CONNECTIONS" "$BENCH_RATE"
  done
done

# Step 6: Generate report
echo ""
echo "[6/6] Generating report..."
bash "$SCRIPT_DIR/generate-report.sh"

# Cleanup
echo ""
echo "Stopping services..."
docker compose down

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Done! Results: benchmark/results/report.md"
echo "═══════════════════════════════════════════════════════"

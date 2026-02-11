#!/usr/bin/env bash
set -euo pipefail

# Usage: benchmark.sh <proxy> <scenario> <duration> <threads> <connections> <rate>
PROXY="$1"
SCENARIO="$2"
DURATION="${3:-30s}"
THREADS="${4:-4}"
CONNECTIONS="${5:-100}"
RATE="${6:-1000}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$BENCH_DIR/results/raw"

mkdir -p "$RESULTS_DIR"

OUTPUT_FILE="$RESULTS_DIR/${PROXY}-${SCENARIO}.txt"

# Parse duration to seconds
DURATION_SECS="${DURATION%s}"

# Calculate total requests: rate * duration
TOTAL_REQUESTS=$(( RATE * DURATION_SECS ))

# Rate limit per worker: total rate / concurrency
RATE_PER_WORKER=$(echo "scale=0; $RATE / $CONNECTIONS" | bc)
if [ "$RATE_PER_WORKER" -lt 1 ]; then
  RATE_PER_WORKER=1
fi

# hey: -n total requests, -c concurrency, -q rate/worker, -z duration
HEY_ARGS="-n ${TOTAL_REQUESTS} -c ${CONNECTIONS} -q ${RATE_PER_WORKER} -z ${DURATION}"

case "$SCENARIO" in
  get)
    URL="http://${PROXY}:8080/api/data"
    CMD="hey $HEY_ARGS $URL"
    ;;
  post)
    URL="http://${PROXY}:8080/api/data"
    CMD="hey $HEY_ARGS -m POST -T application/json -d {\"value\":12345} $URL"
    ;;
  put)
    URL="http://${PROXY}:8080/api/data"
    CMD="hey $HEY_ARGS -m PUT -T application/json -d {\"value\":12345} $URL"
    ;;
  delete)
    URL="http://${PROXY}:8080/api/data"
    CMD="hey $HEY_ARGS -m DELETE $URL"
    ;;
  static)
    URL="http://${PROXY}:8080/static/mountain.jpg"
    CMD="hey $HEY_ARGS $URL"
    ;;
  random-query)
    # hey doesn't support per-request randomization, use unique param per run
    RAND_KEY=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
    RAND_VAL=$(head -c 8 /dev/urandom | od -An -tx1 | tr -d ' \n')
    URL="http://${PROXY}:8080/api/data?${RAND_KEY}=${RAND_VAL}"
    CMD="hey $HEY_ARGS $URL"
    ;;
  *)
    echo "Unknown scenario: $SCENARIO"
    exit 1
    ;;
esac

echo "  [$PROXY] $SCENARIO: $CMD"
docker compose -f "$BENCH_DIR/docker-compose.yml" exec -T wrk $CMD > "$OUTPUT_FILE" 2>&1 || true

# Brief pause between runs
sleep 2

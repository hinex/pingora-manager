#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(dirname "$SCRIPT_DIR")"
RAW_DIR="$BENCH_DIR/results/raw"
REPORT="$BENCH_DIR/results/report.md"

PROXIES="nginx openresty caddy envoy haproxy openlitespeed pingora"
SCENARIOS="get post put delete static random-query"

# Extract metrics from hey output
extract_rps() {
  grep "Requests/sec:" "$1" 2>/dev/null | awk '{print $2}' || echo "N/A"
}

extract_avg_latency() {
  grep "Average:" "$1" 2>/dev/null | awk '{printf "%.2fms", $2 * 1000}' || echo "N/A"
}

extract_fastest() {
  grep "Fastest:" "$1" 2>/dev/null | awk '{printf "%.2fms", $2 * 1000}' || echo "N/A"
}

extract_slowest() {
  grep "Slowest:" "$1" 2>/dev/null | awk '{printf "%.2fms", $2 * 1000}' || echo "N/A"
}

extract_p50() {
  grep "50%%" "$1" 2>/dev/null | awk '{printf "%.2fms", $3 * 1000}' || echo "N/A"
}

extract_p90() {
  grep "90%%" "$1" 2>/dev/null | awk '{printf "%.2fms", $3 * 1000}' || echo "N/A"
}

extract_p99() {
  grep "99%%" "$1" 2>/dev/null | awk '{printf "%.2fms", $3 * 1000}' || echo "N/A"
}

extract_total_requests() {
  grep "\[200\]" "$1" 2>/dev/null | awk '{print $2}' || echo "0"
}

extract_errors() {
  local non200 errs
  non200=$(grep -E "^\s*\[[^2]" "$1" 2>/dev/null | awk '{sum+=$2} END {print sum+0}') || non200=0
  errs=$(grep -c "Error distribution:" "$1" 2>/dev/null) || errs=0
  if [ "$errs" -gt 0 ]; then
    errs=$(grep "Error distribution:" -A 100 "$1" 2>/dev/null | tail -n +2 | grep -c . 2>/dev/null) || errs=0
  fi
  echo $(( ${non200:-0} + ${errs:-0} ))
}

# Generate report
{
  echo "# Benchmark Results"
  echo ""
  echo "**Date:** $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  echo "**CPU limit per proxy:** ${BENCH_CPUS:-1.0} core(s)"
  echo "**Memory limit per proxy:** ${BENCH_MEMORY:-256M}"
  echo "**Duration per test:** ${BENCH_DURATION:-30s}"
  echo "**Connections:** ${BENCH_CONNECTIONS:-100} | **Target rate:** ${BENCH_RATE:-1000} req/s"
  echo ""

  for scenario in $SCENARIOS; do
    echo "## ${scenario^^}"
    echo ""
    echo "| Proxy | Req/s | Avg | P50 | P90 | P99 | Slowest | Errors |"
    echo "|-------|-------|-----|-----|-----|-----|---------|--------|"

    for proxy in $PROXIES; do
      file="$RAW_DIR/${proxy}-${scenario}.txt"
      if [ -f "$file" ] && grep -q "Requests/sec" "$file" 2>/dev/null; then
        rps=$(extract_rps "$file")
        avg=$(extract_avg_latency "$file")
        p50=$(extract_p50 "$file")
        p90=$(extract_p90 "$file")
        p99=$(extract_p99 "$file")
        slowest=$(extract_slowest "$file")
        errors=$(extract_errors "$file")
        echo "| $proxy | $rps | $avg | $p50 | $p90 | $p99 | $slowest | $errors |"
      else
        echo "| $proxy | N/A | N/A | N/A | N/A | N/A | N/A | N/A |"
      fi
    done

    echo ""
  done

  echo "---"
  echo ""
  echo "**Notes:**"
  echo "- nginx, openresty, caddy, openlitespeed, pingora serve static files directly from disk"
  echo "- envoy, haproxy proxy static file requests to the backend (Bun)"
  echo "- All proxies have identical CPU and memory constraints"
  echo "- Benchmarked with [hey](https://github.com/rakyll/hey)"
  echo ""
  echo "**Photo credit:** Mountain image from [Unsplash](https://unsplash.com/photos/NVUxS1SFhKE) (Unsplash License)"

} > "$REPORT"

echo "Report saved to: $REPORT"

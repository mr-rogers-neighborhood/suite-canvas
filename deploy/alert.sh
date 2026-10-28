#!/usr/bin/env bash
# One alerting probe for a running Suite server, for cron or any scheduler that
# reads an exit code.
#
# It fails loudly (exit 1, one ALERT line on stderr) when:
#   * GET /health is not 200,
#   * the document database is above the configured disk soft watermark,
#   * resident memory is above the threshold.
#
# It exits 2 when it cannot check at all (no /metrics answer), because an
# alerting path that silently passes is worse than one that wakes you up.
#
# Usage:
#   deploy/alert.sh [--url URL] [--token TOKEN] [--rss-limit-mb MB] [--json] [--cloudwatch]
#
# Environment:
#   SUITE_ALERT_URL          base URL of the API port (default http://127.0.0.1:1235)
#   SUITE_ADMIN_TOKEN        optional session token, for a scrape that is not local
#   SUITE_ALERT_RSS_LIMIT_MB resident-memory threshold in MiB (default 1024)
#   SUITE_ALERT_TIMEOUT      curl timeout in seconds (default 5)
#   SUITE_ALERT_CLOUDWATCH   1 (or --cloudwatch) publishes a `Health` metric to
#                            CloudWatch, so an alarm can page instead of cron
#                            mailing a log nobody reads
#   SUITE_ALERT_DEPLOYMENT   dimension value for that metric (default: hostname)
#   AWS_REGION               region the metric goes to (the instance role's default)
#
# `/metrics` is gated by an operator session. A cron timer has no browser and cannot
# hold one, so the relay allows an unauthenticated read from a loopback address when
# `SUITE_METRICS_LOCAL=1`. That is the intended cron setup; `SUITE_ADMIN_TOKEN` exists
# only for a probe that runs on another machine and can present a session token.
#
# Cron example, on a host whose alarms are in CloudWatch rather than in local mail:
#   */5 * * * * SUITE_METRICS_LOCAL=1 /srv/suite/deploy/alert.sh --cloudwatch
set -euo pipefail

usage() {
  sed -n '2,22p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --cloudwatch) SUITE_ALERT_CLOUDWATCH=1 ;;
  esac
done

BASE_URL="${SUITE_ALERT_URL:-http://127.0.0.1:1235}"
TOKEN="${SUITE_ADMIN_TOKEN:-}"
RSS_LIMIT_MB="${SUITE_ALERT_RSS_LIMIT_MB:-1024}"
TIMEOUT="${SUITE_ALERT_TIMEOUT:-5}"
AS_JSON=0
CLOUDWATCH="${SUITE_ALERT_CLOUDWATCH:-0}"
DEPLOYMENT="${SUITE_ALERT_DEPLOYMENT:-$(hostname 2>/dev/null || printf 'suite')}"

# One metric per run, published on the way out so a failure is a datapoint rather than a
# log line: `Health` is 1 when every check passed and 0 when one did not, and the alarm on
# it is what actually pages. A refused publish is reported and never changes the exit code,
# because the exit code is the other half of this script's contract.
publish_health() {
  local status=$?
  [ "$CLOUDWATCH" = "1" ] || return 0
  if ! command -v aws >/dev/null 2>&1; then
    printf 'CANNOT PUBLISH: the aws CLI is not installed\n' >&2
    return 0
  fi
  local value=0
  [ "$status" -eq 0 ] && value=1
  if ! aws cloudwatch put-metric-data \
    --namespace Suite --metric-name Health --value "$value" --unit None \
    --dimensions "Deployment=$DEPLOYMENT" >/dev/null 2>&1; then
    printf 'CANNOT PUBLISH: CloudWatch refused the Health metric\n' >&2
  fi
  return 0
}

trap publish_health EXIT

while [ $# -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --url)
      BASE_URL="${2:?--url needs a value}"
      shift 2
      ;;
    --token)
      TOKEN="${2:?--token needs a value}"
      shift 2
      ;;
    --rss-limit-mb)
      RSS_LIMIT_MB="${2:?--rss-limit-mb needs a value}"
      shift 2
      ;;
    --json)
      AS_JSON=1
      shift
      ;;
    # Already read by the loop above, which runs before `CLOUDWATCH` is initialised, so it
    # has to be accepted here too or the flag this script documents is rejected as unknown.
    --cloudwatch)
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

BASE_URL="${BASE_URL%/}"
case "$RSS_LIMIT_MB" in
  '' | *[!0-9]*)
    echo "CANNOT CHECK: --rss-limit-mb must be a whole number of MiB" >&2
    exit 2
    ;;
esac

alert() {
  echo "ALERT: $*" >&2
  exit 1
}

cannot_check() {
  echo "CANNOT CHECK: $*" >&2
  exit 2
}

# KiB/MiB/GiB for a byte count, so a log line reads like the docs.
human_bytes() {
  awk -v bytes="$1" 'BEGIN {
    split("B KiB MiB GiB TiB", unit, " ");
    step = 1;
    while (bytes >= 1024 && step < 5) { bytes /= 1024; step++ }
    printf "%.1f %s", bytes, unit[step];
  }'
}

# One unlabelled sample from the Prometheus body; prints nothing when absent.
metric() {
  printf '%s\n' "$METRICS_BODY" | awk -v name="$1" '$1 == name { print $2; exit }'
}

have_metric() {
  printf '%s\n' "$METRICS_BODY" | awk -v name="$1" '$1 == name { found = 1; exit } END { exit !found }'
}

# --- 1. readiness -----------------------------------------------------------
HEALTH_CODE="$(
  curl -sS --max-time "$TIMEOUT" -o /dev/null -w '%{http_code}' "$BASE_URL/health" || echo "000"
)"
if [ "$HEALTH_CODE" != "200" ]; then
  alert "/health answered $HEALTH_CODE (expected 200) at $BASE_URL/health"
fi

# --- 2. metrics are reachable ----------------------------------------------
# No token is fine for the documented setup: a probe running on the box reads
# /metrics from a loopback address, which `SUITE_METRICS_LOCAL=1` allows.
AUTH_ARGS=()
if [ -n "$TOKEN" ]; then
  AUTH_ARGS=(-H "Authorization: Bearer $TOKEN")
fi

RESPONSE="$(
  curl -sS --max-time "$TIMEOUT" -w $'\n%{http_code}' \
    "${AUTH_ARGS[@]}" "$BASE_URL/metrics" 2>/dev/null || true
)"
METRICS_CODE="${RESPONSE##*$'\n'}"
METRICS_BODY="${RESPONSE%$'\n'*}"
case "$METRICS_CODE" in
  200) ;;
  401) cannot_check "/metrics answered 401; set SUITE_METRICS_LOCAL=1 on the relay for a local scrape, or pass --token" ;;
  404) cannot_check "/metrics answered 404; the relay has no SUITE_AUTH_URL, so the scrape is off" ;;
  *) alert "/metrics answered ${METRICS_CODE:-000} (expected 200) at $BASE_URL/metrics" ;;
esac

# --- 3. disk watermark ------------------------------------------------------
DISK_LINE="skipped: suite_database_bytes is absent"
if have_metric suite_database_bytes; then
  DATABASE_BYTES="$(metric suite_database_bytes)"
  if have_metric suite_disk_soft_bytes; then
    SOFT_BYTES="$(metric suite_disk_soft_bytes)"
    if [ "$DATABASE_BYTES" -gt "$SOFT_BYTES" ]; then
      alert "database is $(human_bytes "$DATABASE_BYTES"), above the soft watermark of $(human_bytes "$SOFT_BYTES")"
    fi
    DISK_LINE="$(human_bytes "$DATABASE_BYTES") of $(human_bytes "$SOFT_BYTES") soft watermark"
  else
    DISK_LINE="$(human_bytes "$DATABASE_BYTES"), soft watermark unlimited"
  fi
fi

# --- 4. resident memory -----------------------------------------------------
RSS_LINE="skipped: suite_rss_bytes is absent"
if have_metric suite_rss_bytes; then
  RSS_BYTES="$(metric suite_rss_bytes)"
  RSS_LIMIT_BYTES=$((RSS_LIMIT_MB * 1024 * 1024))
  if [ "$RSS_BYTES" -gt "$RSS_LIMIT_BYTES" ]; then
    alert "RSS is $(human_bytes "$RSS_BYTES"), above the ${RSS_LIMIT_MB} MiB threshold"
  fi
  RSS_LINE="$(human_bytes "$RSS_BYTES") under ${RSS_LIMIT_MB} MiB"
fi

SAMPLES="$(printf '%s\n' "$METRICS_BODY" | grep -c '^suite_' || true)"

if [ "$AS_JSON" -eq 1 ]; then
  VERSION="$(printf '%s\n' "$METRICS_BODY" | awk -F'"' '/^suite_build_info\{/ { print $2; exit }')"
  DATABASE_JSON="null"
  if have_metric suite_database_bytes; then DATABASE_JSON="$(metric suite_database_bytes)"; fi
  RSS_JSON="null"
  if have_metric suite_rss_bytes; then RSS_JSON="$(metric suite_rss_bytes)"; fi
  printf '{"ok":true,"url":"%s","version":"%s","health":%s,"samples":%s,"databaseBytes":%s,"rssBytes":%s,"rssLimitMb":%s}\n' \
    "$BASE_URL" "$VERSION" "$HEALTH_CODE" "$SAMPLES" "$DATABASE_JSON" "$RSS_JSON" "$RSS_LIMIT_MB"
  exit 0
fi

printf 'OK   health  %s answered %s\n' "$BASE_URL/health" "$HEALTH_CODE"
printf 'OK   metrics %s metric samples served\n' "$SAMPLES"
printf 'OK   disk    %s\n' "$DISK_LINE"
printf 'OK   memory  %s\n' "$RSS_LINE"

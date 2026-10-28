#!/usr/bin/env bash
# CloudWatch alarms for a deployed Suite host, created or updated in one run.
#
# What it makes: one SNS topic with your address subscribed, and five alarms that each say
# something a person can act on. `put-metric-alarm` is idempotent, so running this again is
# how a threshold is changed.
#
#   suite-health     Suite/Health is 0              the probe in deploy/alert.sh failed
#   suite-missing    Suite/Health has no data       the probe stopped running at all
#   ec2-status       an EC2 status check failed     the instance or its network is gone
#   ec2-cpu          CPU above 80% for 15 min       one board is eating the core
#   rds-storage      RDS free storage under 2 GiB   the accounts database is filling up
#
# The first two are the pair that matters: an alarm that only fires on a *bad* datapoint is
# silent when the thing reporting it dies.
#
# Usage:
#   deploy/cloudwatch/setup.sh --email you@example.com [--instance i-0123…] [--db suite-db]
#
# Environment:
#   AWS_REGION          region for the metrics and alarms (default: the profile's)
#   SUITE_DEPLOYMENT    the Deployment dimension value (default: hostname)
#   SUITE_ALERT_EMAIL   the address to subscribe, if --email is not given
#
# Requires permission to create an SNS topic, subscribe an address and put alarms. Run it
# from a workstation with the operator profile rather than from the box: the instance role
# holds only what publishing a metric and writing a log needs.
set -euo pipefail

usage() {
  sed -n '2,23p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

EMAIL="${SUITE_ALERT_EMAIL:-}"
INSTANCE=""
DB=""
DEPLOYMENT="${SUITE_DEPLOYMENT:-$(hostname 2>/dev/null || printf 'suite')}"

while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; shift 2 ;;
    --instance) INSTANCE="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if [ -z "$EMAIL" ]; then
  printf 'error: --email is required; it is where the alarms go\n' >&2
  exit 1
fi
if ! command -v aws >/dev/null 2>&1; then
  printf 'error: the aws CLI is not on PATH\n' >&2
  exit 1
fi

# The instance and the database are discovered rather than typed when there is exactly one
# of each, so the common case is one argument.
if [ -z "$INSTANCE" ]; then
  INSTANCE="$(aws ec2 describe-instances \
    --filters "Name=instance-state-name,Values=running" "Name=tag:Name,Values=suite-app" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null | head -n 1 || true)"
  INSTANCE="${INSTANCE//None/}"
fi
if [ -z "$DB" ]; then
  DB="$(aws rds describe-db-instances \
    --query 'DBInstances[].DBInstanceIdentifier' --output text 2>/dev/null | head -n 1 || true)"
  DB="${DB//None/}"
fi

TOPIC="$(aws sns create-topic --name suite-alerts --query TopicArn --output text)"
printf 'topic      %s\n' "$TOPIC"

# A second subscribe re-sends the confirmation mail; once confirmed, AWS answers
# "Subscription already exists", which is not a failure here.
aws sns subscribe --topic-arn "$TOPIC" --protocol email --notification-endpoint "$EMAIL" \
  >/dev/null 2>&1 ||
  printf 'note       %s is already subscribed (or the confirmation is still pending)\n' "$EMAIL"

# One alarm, created or updated. Named arguments rather than nine positional ones, because
# a threshold and a period are both numbers and swapping them is silent.
#   put_alarm <name> <description> <metric> <namespace> <statistic> <comparison>
#             <threshold> <periods> <period> <dimension> <missing>
put_alarm() {
  local name=$1 description=$2 metric=$3 namespace=$4 statistic=$5 comparison=$6
  local threshold=$7 periods=$8 period=$9 dimension=${10} missing=${11}

  aws cloudwatch put-metric-alarm \
    --alarm-name "$name" \
    --alarm-description "$description" \
    --metric-name "$metric" \
    --namespace "$namespace" \
    --statistic "$statistic" \
    --comparison-operator "$comparison" \
    --threshold "$threshold" \
    --evaluation-periods "$periods" \
    --period "$period" \
    --treat-missing-data "$missing" \
    --dimensions "$dimension" \
    --alarm-actions "$TOPIC" \
    --ok-actions "$TOPIC"
  printf 'alarm      %-14s %s\n' "$name" "$description"
}

# The probe, and its absence. "No data" is not "fine": a dead cron job is the failure this
# pair exists to catch.
put_alarm suite-health \
  "The Suite probe failed: /health, a disk watermark or resident memory." \
  Health Suite Minimum LessThanThreshold 1 2 300 \
  "Name=Deployment,Value=$DEPLOYMENT" breaching

put_alarm suite-missing \
  "The Suite probe has not reported for 15 minutes: check cron and deploy/alert.sh." \
  Health Suite Minimum LessThanThreshold 1 3 300 \
  "Name=Deployment,Value=$DEPLOYMENT" breaching

if [ -n "$INSTANCE" ]; then
  put_alarm ec2-status \
    "An EC2 status check is failing on $INSTANCE." \
    StatusCheckFailed AWS/EC2 Maximum GreaterThanOrEqualToThreshold 1 2 60 \
    "Name=InstanceId,Value=$INSTANCE" missing

  put_alarm ec2-cpu \
    "Sustained CPU above 80% on $INSTANCE: a room rebuild, or a leak." \
    CPUUtilization AWS/EC2 Average GreaterThanThreshold 80 3 300 \
    "Name=InstanceId,Value=$INSTANCE" missing
else
  printf 'note       no running instance tagged Name=suite-app; the EC2 alarms were skipped\n' >&2
fi

if [ -n "$DB" ]; then
  put_alarm rds-storage \
    "Free storage on $DB is under 2 GiB: accounts and billing are at risk." \
    FreeStorageSpace AWS/RDS Minimum LessThanThreshold 2147483648 1 300 \
    "Name=DBInstanceIdentifier,Value=$DB" missing
else
  printf 'note       no RDS instance found; the storage alarm was skipped\n' >&2
fi

printf '\nconfirm the subscription in %s, then the alarms have somewhere to go.\n' "$EMAIL"

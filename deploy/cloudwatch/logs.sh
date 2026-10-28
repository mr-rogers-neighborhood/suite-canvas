#!/usr/bin/env bash
# The log group the deployed stack writes into, created once and kept.
#
# `deploy/compose.aws.yaml` points Docker's `awslogs` driver at `${SUITE_LOG_GROUP:-suite-app}`.
# The driver appends to a group it is given; it is not allowed to create one, because a
# container that can create log groups can create them across the account. This script is
# the one place a group is made, so the role stays as small as it can be.
#
# Retrograde retention rather than forever: 30 days is enough to answer "what happened last
# week", and log storage is the one bill that grows without anyone noticing.
#
# Usage: deploy/cloudwatch/logs.sh [--group suite-app] [--days 30]
set -euo pipefail

GROUP="${SUITE_LOG_GROUP:-suite-app}"
DAYS="30"

while [ $# -gt 0 ]; do
  case "$1" in
    --group) GROUP="${2:-}"; shift 2 ;;
    --days) DAYS="${2:-}"; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 1 ;;
  esac
done

if ! command -v aws >/dev/null 2>&1; then
  printf 'error: the aws CLI is not on PATH\n' >&2
  exit 1
fi

if aws logs describe-log-groups --log-group-name-prefix "$GROUP" \
  --query "logGroups[?logGroupName=='$GROUP'].logGroupName" --output text | grep -qx "$GROUP"; then
  printf 'group      %s already exists\n' "$GROUP"
else
  aws logs create-log-group --log-group-name "$GROUP"
  printf 'group      %s created\n' "$GROUP"
fi

aws logs put-retention-policy --log-group-name "$GROUP" --retention-in-days "$DAYS"
printf 'retention  %s days\n' "$DAYS"

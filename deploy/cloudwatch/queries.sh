#!/usr/bin/env bash
# The questions worth asking this deployment, ready to run.
#
# Every one of these has already been asked once, in the middle of something, by hand,
# with the clock running. Saving them is the whole point: the next time a sign-in fails or
# a webhook is rejected, the query is not retyped from memory under pressure.
#
#   deploy/cloudwatch/queries.sh                 # list the names
#   deploy/cloudwatch/queries.sh errors          # run one, last hour
#   deploy/cloudwatch/queries.sh webhooks 6      # run one, last six hours
#
# Environment:
#   SUITE_LOG_GROUP   log group (default: suite-app)
#   AWS_REGION        region (default: us-east-2)
#   AWS_PROFILE       profile (default: $AWS_PROFILE, else the ambient credentials)
set -uo pipefail

group=${SUITE_LOG_GROUP:-suite-app}
region=${AWS_REGION:-us-east-2}
profile=${AWS_PROFILE:-}
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

aws_args=(--region "$region")
[ -n "$profile" ] && aws_args+=(--profile "$profile")

# Each entry is a name, a sentence saying what question it answers, and the query.
names=(errors auth admin webhooks relay csp)
questions=(
  "Every error-level line, newest group first. The sweep to start with."
  "Sign-in, sign-up and session refusals: the first place a new account fails."
  "Operator mutations and refusals, so a panel click can be traced to an actor."
  "Stripe deliveries and their signature checks, for the paid loop."
  "Relay 5xx and socket refusals: a board that will not sync."
  "Content-Security-Policy reports, which is how a blocked script is found."
)
queries=(
  'fields @timestamp, msg, component, @message | filter level = "error" | sort @timestamp desc | limit 100'
  'fields @timestamp, path, status, code, message | filter msg like /auth/ or path like /api\/auth/ | sort @timestamp desc | limit 100'
  'fields @timestamp, actor, action, result, target | filter msg = "admin.mutation" | sort @timestamp desc | limit 100'
  'fields @timestamp, msg, status, @message | filter @message like /stripe/ | sort @timestamp desc | limit 100'
  'fields @timestamp, path, status, durationMs | filter status >= 500 or status = 401 | sort @timestamp desc | limit 100'
  'fields @timestamp, @message | filter msg like /csp/ or @message like /report-uri/ | sort @timestamp desc | limit 100'
)

usage() {
  printf 'usage: %s [name] [hours]\n\n' "$(basename "$0")"
  for i in "${!names[@]}"; do
    printf '  %-9s %s\n' "${names[$i]}" "${questions[$i]}"
  done
}

if [ $# -eq 0 ]; then
  usage
  exit 0
fi

name=$1
hours=${2:-1}
index=-1
for i in "${!names[@]}"; do
  [ "${names[$i]}" = "$name" ] && index=$i
done
if [ "$index" -lt 0 ]; then
  printf 'queries: unknown query: %s\n\n' "$name" >&2
  usage >&2
  exit 2
fi

end=$(date -u +%s)
start=$((end - hours * 3600))
id=$(aws logs start-query "${aws_args[@]}" \
  --log-group-name "$group" \
  --start-time "$start" --end-time "$end" \
  --query-string "${queries[$index]}" \
  --query 'queryId' --output text) || exit 1

# Logs Insights answers a query with an id and fills it in afterwards, so ask until it says
# something complete. Twenty tries at half a second is longer than any of these take.
for _ in $(seq 1 40); do
  sleep 0.5
  status=$(aws logs get-query-results "${aws_args[@]}" --query-id "$id" --query 'status' --output text)
  [ "$status" = "Complete" ] && break
done

aws logs get-query-results "${aws_args[@]}" --query-id "$id" \
  --query 'results[].[@ptr]' --output text >/dev/null 2>&1

aws logs get-query-results "${aws_args[@]}" --query-id "$id" --output json |
  python3 -c '
import json,sys
rows=json.load(sys.stdin)["results"]
if not rows:
    print("no matching lines in that window")
    raise SystemExit(0)
for row in rows:
    fields={cell["field"]: cell["value"] for cell in row}
    stamp=fields.pop("@timestamp","")
    msg=fields.pop("@message","")
    rest=" ".join(f"{k}={v}" for k,v in fields.items() if v not in ("", None))
    print(f"{stamp}  {rest}  {msg[:400]}")
print(f"\n{len(rows)} line(s)")
'

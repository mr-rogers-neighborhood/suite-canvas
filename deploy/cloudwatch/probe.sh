#!/usr/bin/env bash
# The health probe, arranged so that both halves can do their job.
#
# `deploy/alert.sh` scrapes `http://127.0.0.1:1235/metrics`, and the relay only answers that
# without a session when the *source* is loopback (`SUITE_METRICS_LOCAL=1`). A request
# through a Docker port mapping arrives from the bridge gateway, so the host cannot make
# that scrape — it has to run inside the relay container's network namespace.
#
# Inside that namespace, however, the EC2 instance metadata service is unreachable, so the
# `aws` client has no credentials and cannot publish. Rather than widen either guard, this
# script does one in each place: scrape in the namespace, publish the datapoint from the
# host, and exit with the probe's own code.
#
#   deploy/cloudwatch/probe.sh            # scrape, publish Suite/Health and Suite/CertificateDays
#   deploy/cloudwatch/probe.sh --no-publish
#
# Environment:
#   SUITE_APP_CONTAINER   relay container name (default: suite-app-1)
#   SUITE_LOG_DEPLOYMENT  dimension value (default: the host name)
#   SUITE_PROBE_HOST      the host name whose certificate is measured (default: app.suite.run)
set -uo pipefail

container=${SUITE_APP_CONTAINER:-suite-app-1}
# A stable name, not `hostname`. The default host name on EC2 is `ip-<private ip>`, which
# changes when the instance is stopped and started, and an alarm watching a dimension that
# no longer reports sits in INSUFFICIENT_DATA — which reads exactly like healthy.
deployment=${SUITE_LOG_DEPLOYMENT:-suite-app}
namespace=Suite
publish=1

for arg in "$@"; do
  case "$arg" in
    --no-publish) publish=0 ;;
    *)
      printf 'probe: unknown argument: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
alert_script="$here/../alert.sh"
[ -x "$alert_script" ] || {
  printf 'probe: cannot find %s\n' "$alert_script" >&2
  exit 2
}

pid=$(docker inspect -f '{{.State.Pid}}' "$container" 2>/dev/null)
[ -n "$pid" ] && [ "$pid" != "0" ] || {
  printf 'probe: %s is not running\n' "$container" >&2
  exit 2
}

# The scrape, with the relay's own view of loopback.
nsenter -t "$pid" -n env SUITE_METRICS_LOCAL=1 "$alert_script"
status=$?

[ "$publish" = 1 ] || exit "$status"

value=0
[ "$status" -eq 0 ] && value=1
aws cloudwatch put-metric-data \
  --namespace "$namespace" --metric-name Health --value "$value" --unit None \
  --dimensions "Deployment=$deployment" >/dev/null 2>&1 ||
  printf 'probe: CloudWatch refused the Health metric (value %s)\n' "$value" >&2

# Days left on the certificate the browser actually sees.
#
# An expired or unissued certificate is invisible to every other check here: the relay is
# healthy, the container is up, `/health` answers 200 on loopback, and the site is down. That
# is exactly how a spent ACME rate limit turned into an afternoon of "the site is refused and
# everything looks fine". Reading `notAfter` from the origin closes it, and 14 days is enough
# notice to act on a renewal that failed quietly.
probe_host=${SUITE_PROBE_HOST:-app.suite.run}
expiry=$(openssl s_client -connect 127.0.0.1:443 -servername "$probe_host" -verify_return_error \
  </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | sed 's/^notAfter=//')
if [ -n "$expiry" ]; then
  seconds=$(($(date -d "$expiry" +%s) - $(date +%s)))
  days=$((seconds / 86400))
  aws cloudwatch put-metric-data \
    --namespace "$namespace" --metric-name CertificateDays --value "$days" --unit Count \
    --dimensions "Deployment=$deployment" >/dev/null 2>&1 ||
    printf 'probe: CloudWatch refused the CertificateDays metric (%s days)\n' "$days" >&2
else
  # No certificate to read is the loudest version of the same problem: publish nothing and
  # let the alarm's INSUFFICIENT_DATA do the talking rather than reporting a fake zero.
  printf 'probe: could not read a certificate for %s\n' "$probe_host" >&2
fi

exit "$status"

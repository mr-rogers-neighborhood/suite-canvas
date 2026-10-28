# Observe a deployment

Where to look when something is wrong, and what each surface can and cannot tell you. Written
for two people working on one box: the owner and whoever is helping them.

Everything here reads CloudWatch, so it needs `AWS_PROFILE=suite` and `AWS_REGION=us-east-2`.

## The three surfaces

| Surface | Answers | Does not answer |
| --- | --- | --- |
| Logs (`suite-app`) | what happened, in order, with the request id | whether it is still happening |
| Alarms (`Suite/*`, `AWS/*`) | is anything red right now | why |
| `/metrics` via `deploy/alert.sh` | rooms, memory, connections at this instant | what led there |

The panel at `/admin.html` is a fourth, narrow one: it answers "who is signed in, what have
they claimed, and what has an operator changed", and the activity list is the audit trail for
every operator write.

## Start here

```sh
AWS_PROFILE=suite deploy/cloudwatch/queries.sh            # the saved questions
AWS_PROFILE=suite deploy/cloudwatch/queries.sh errors 6   # the last six hours
```

Six queries are saved, because each has already been asked once under pressure:
`errors`, `auth`, `admin`, `webhooks`, `relay` and `csp`. Each names the symptom it addresses
in its own output. They run against the `suite-app` group, where every container's JSON lines
land under a stream named after the service (`app`, `control-plane`, `caddy`).

A line is JSON with `level`, `msg`, `component` and, for a request, `path` and `status`. When
two lines disagree about what happened, the `requestId` on both is how they are tied together.

## Alarms

```sh
aws cloudwatch describe-alarms --profile suite --region us-east-2 \
  --query 'MetricAlarms[].[AlarmName,StateValue]' --output text
```

Six alarms, and what each one means in practice:

| Alarm | Fires when | Usual cause |
| --- | --- | --- |
| `suite-health` | the probe's `/health` fetch failed | the relay is down, or a container is unhealthy |
| `suite-missing` | the health metric has not reported | the probe is not running, or it cannot publish |
| `ec2-cpu`, `ec2-status` | the instance is saturated or failing its own checks | a build on the box, or a host fault |
| `rds-storage` | Postgres is short of free space | attachments or the update log growing |
| `suite-certificate` | `CertificateDays` is under 14, or was never published | the certificate was not renewed, or the origin serves none |

The last one treats missing data as breaching, on purpose: "no certificate" is exactly the
state that took the site down for an afternoon, and it arrives as an absence rather than as a
failure.

`CertificateDays` in the `Suite` namespace is the sixth, and the one that was added after an
outage taught us why: `deploy/cloudwatch/probe.sh` reads `notAfter` from the certificate the
browser actually gets and publishes the days left. Without it, a spent ACME rate limit looked
exactly like a healthy deployment, because the relay answered `/health` on loopback the whole
time the public site was refusing connections.

The lesson generalises: an alarm on the *service* cannot see a failure in the layer *in front
of* it. TLS, DNS and the proxy are all that layer.

## What is not covered

Client-side exceptions. The app has scrubbed, opt-in crash reporting built
(`apps/canvas/src/crash/report.ts`) and no DSN configured, so nothing leaves a reader's
browser. A JavaScript error in a card editor is therefore visible only through the diagnostics
bundle the app can copy, which is a deliberate choice while the deployment has two users and
no error tracker.

That is the first thing a hosted tracker buys. Until then, when a browser-only problem is
reported, ask for the copied diagnostics: it carries the build, the route, the storage state
and the last uncaught error, which is most of what a tracker would have shown.

## The metrics probe

`deploy/cloudwatch/probe.sh` runs from `/etc/cron.d/suite` every five minutes and publishes
`Suite/Health` and `Suite/CertificateDays`, exiting non-zero when a check fails. `SUITE_PROBE_HOST`
names the certificate it reads (default `app.suite.run`), and no certificate at all publishes
nothing, so the alarm's `INSUFFICIENT_DATA` says so rather than a fake zero. It scrapes
`/metrics` inside the relay's namespace because the relay only answers a loopback source, and
publishes from the host because the instance metadata is unreachable from inside that
namespace.

If `suite-missing` is in `ALARM`, run the probe by hand first, then check that
`SUITE_METRICS_LOCAL=1` is in `.env` on the host. Without it `/metrics` answers 401 and the
probe has nothing to publish, which is precisely how both alarms came to be red while the
site was fine.

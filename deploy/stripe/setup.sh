#!/usr/bin/env bash
#
# Local Stripe setup for test-mode billing.
#
#   pnpm stripe                     create the fixture prices, print the environment
#   pnpm stripe --listen            forward webhooks to the control plane
#   pnpm stripe --clock             create a test clock for a renewal run
#
# Nothing here talks to a live account: every Stripe call is in test mode, and the
# secret key comes from `stripe login`, not from the dashboard.

set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fixtures="$here/fixtures.json"
port="${SUITE_CONTROL_PLANE_PORT:-1236}"
webhook_path="/api/auth/stripe/webhook"

die() {
  printf '%s\n' "$1" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: pnpm stripe [--listen | --clock | --help]

  (no flag)   create or reuse the fixture prices in fixtures.json, then print the
              environment the control plane needs
  --listen    forward Stripe webhooks to http://localhost:1236/api/auth/stripe/webhook
  --clock     create a test clock, and print the commands that move it forward
  --help      this text
USAGE
}

need_cli() {
  command -v stripe >/dev/null 2>&1 ||
    die "the Stripe CLI is not installed: https://docs.stripe.com/stripe-cli"
}

need_fixtures() {
  [ -f "$fixtures" ] || die "missing $fixtures"
}

# The first id in a Stripe answer: a list prints {"data":[...]}, a create prints one object.
first_id() {
  node -e '
    let raw = "";
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      const parsed = JSON.parse(raw === "" ? "null" : raw);
      const first = Array.isArray(parsed) ? parsed[0] : parsed;
      const id = first && first.data ? (first.data[0] || {}).id : first && first.id;
      process.stdout.write(id || "");
    });
  '
}

test_key() {
  stripe config --list 2>/dev/null |
    sed -n "s/^test_mode_api_key = '\(.*\)'\$/\1/p"
}

listen() {
  need_cli
  printf 'Forwarding Stripe test-mode webhooks to localhost:%s%s\n' "$port" "$webhook_path"
  printf 'Copy the whsec_... secret this prints into STRIPE_WEBHOOK_SECRET, then restart the control plane.\n\n'
  exec stripe listen --forward-to "localhost:$port$webhook_path"
}

clock() {
  need_cli
  local created clock_id
  created="$(stripe test_helpers test_clocks create --format json)"
  clock_id="$(printf '%s' "$created" | first_id)"
  [ -n "$clock_id" ] || die "Stripe created no test clock: $created"

  cat <<CLOCK
Test clock: $clock_id

Attach it to the customer the plugin created for your organization:

  stripe customers update <cus_...> -d test_clock=$clock_id

Move it forward a month and watch the renewal land:

  stripe test_helpers test_clocks advance $clock_id -d "frozen_time=$(($(date +%s) + 2630000))"

Then read the entitlement again:

  curl -sS -X POST localhost:$port/api/billing/entitlement \\
    -H 'content-type: application/json' -d '{"organizationId":"<org id>"}'
CLOCK
}

create_fixtures() {
  need_cli
  need_fixtures

  local key
  key="$(test_key)"
  [ -n "$key" ] || die "no test-mode key: run 'stripe login' first"

  local currency
  currency="$(node -e 'process.stdout.write(require(process.argv[1]).currency)' "$fixtures")"

  local tiers="{" sep="" created=0 reused=0
  local tier name lookup amount workspaces document_bytes attachment_bytes price

  while IFS=$'\t' read -r tier name lookup amount workspaces document_bytes attachment_bytes; do
    price="$(stripe prices list --format json -d "lookup_keys[]=$lookup" -d limit=1 | first_id)"
    if [ -n "$price" ]; then
      reused=$((reused + 1))
    else
      price="$(
        stripe prices create --format json \
          -d "currency=$currency" \
          -d "unit_amount=$amount" \
          -d "recurring[interval]=month" \
          -d "product_data[name]=$name" \
          -d "lookup_key=$lookup" | first_id
      )"
      [ -n "$price" ] || die "Stripe created no price for $lookup"
      created=$((created + 1))
    fi
    tiers="$tiers$sep\"$price\":{\"tier\":\"$tier\",\"workspaces\":$workspaces,\"documentBytes\":$document_bytes,\"attachmentBytes\":$attachment_bytes}"
    sep=","
  done < <(
    node -e '
      const fixture = require(process.argv[1]);
      for (const plan of fixture.plans) {
        process.stdout.write(
          [plan.tier, plan.name, plan.lookupKey, plan.unitAmount, plan.workspaces, plan.documentBytes, plan.attachmentBytes].join("\t") + "\n",
        );
      }
    ' "$fixtures"
  )
  tiers="$tiers}"

  printf 'Prices: %s created, %s reused.\n\n' "$created" "$reused"
  cat <<ENV
Add these to the control plane's environment:

STRIPE_SECRET_KEY=$key
STRIPE_WEBHOOK_SECRET=<whsec_... from `pnpm stripe --listen`>
STRIPE_PRICE_TIERS='$tiers'
SUITE_CONTROL_PLANE_PORT=$port

Start the control plane in one terminal:

  pnpm --filter @suite/control-plane dev

Forward webhooks in another:

  pnpm stripe --listen
ENV
}

case "${1:-}" in
  "") create_fixtures ;;
  --listen) listen ;;
  --clock) clock ;;
  --help | -h) usage ;;
  *) usage >&2; exit 2 ;;
esac

#!/usr/bin/env bash
#
# Local Stripe setup for test-mode billing.
#
#   pnpm stripe --login             log the CLI in, then create the fixtures and print
#                                   the environment the control plane needs
#   pnpm stripe                     create or reuse the fixture prices, print the environment
#   pnpm stripe --listen            forward webhooks to the control plane
#   pnpm stripe --clock             create a test clock for a renewal run
#
# Nothing here talks to a live account: every Stripe call is in test mode, and the
# secret key comes from `stripe login`, not from the dashboard.
#
# Logging in and creating prices are two steps, and the first one is a browser
# flow. `--login` runs both in order, which is what a first run wants.

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
Usage: pnpm stripe [--login | --listen | --clock | --help]

  --login     run `stripe login`, then do what the no-flag form does
  (no flag)   create or reuse the fixture prices in fixtures.json, then print the
              environment the control plane needs. Requires a logged-in CLI.
  --listen    forward Stripe webhooks to http://localhost:1236/api/auth/stripe/webhook
  --clock     create a test clock, and print the commands that move it forward
  --help      this text
USAGE
}

need_cli() {
  command -v stripe >/dev/null 2>&1 && return 0
  cat >&2 <<'MISSING'
The Stripe CLI is not installed, or not on PATH.

Install it, then come back:

  Arch        yay -S stripe-cli      (or: paru -S stripe-cli)
  macOS       brew install stripe/stripe-cli/stripe
  Debian      see https://docs.stripe.com/stripe-cli#install
  Any         download the release binary for your platform:
              https://github.com/stripe/stripe-cli/releases

Then log in, which opens a browser:

  pnpm stripe --login

Billing is optional. Without it sign-in, organizations and sync all work; only
checkout and the customer portal are unavailable.
MISSING
  exit 1
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
  local root="$here/../.."
  local from_env
  # `.env` first: a key there is the deployment's key, and newer CLIs keep a
  # sandbox-vs-live choice of their own that a bare `stripe prices list` ignores.
  from_env="$(sed -n 's/^STRIPE_SECRET_KEY=//p' "$root/.env" 2>/dev/null | head -1 | tr -d "\"'")"
  if [ -n "$from_env" ]; then
    printf '%s' "$from_env"
    return 0
  fi
  stripe config --list 2>/dev/null |
    sed -n "s/^test_mode_api_key = '\(.*\)'\$/\1/p"
}

login() {
  need_cli
  printf 'Opening the Stripe browser login. Choose a test-mode account.\n\n'
  stripe login
  printf '\nLogged in. Creating the fixture prices next.\n\n'
  create_fixtures
}

listen() {
  need_cli
  printf 'Forwarding Stripe test-mode webhooks to localhost:%s%s\n' "$port" "$webhook_path"
  printf 'Copy the whsec_... secret this prints into STRIPE_WEBHOOK_SECRET, then restart the control plane.\n\n'
  # The CLI requires an event selection; `--events '*'` was retired in its favour.
  exec stripe listen --all-snapshot --forward-to "localhost:$port$webhook_path"
}

clock() {
  need_cli
  local created clock_id
  created="$(stripe test_helpers test_clocks create -c)"
  clock_id="$(printf '%s' "$created" | first_id)"
  [ -n "$clock_id" ] || die "Stripe created no test clock: $created"

  cat <<CLOCK
Test clock: $clock_id

Attach it to the customer the plugin created for your organization:

  stripe customers update -c <cus_...> -d test_clock=$clock_id

Move it forward a month and watch the renewal land:

  stripe test_helpers test_clocks advance -c $clock_id -d "frozen_time=$(($(date +%s) + 2630000))"

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
  # Every call below is a test-mode call. The CLI defaults to whatever mode the
  # logged-in account was switched to, and a test key is the one thing that makes
  # the answer independent of that choice.
  [ -n "$key" ] && export STRIPE_API_KEY="$key"
  if [ -z "$key" ]; then
    cat >&2 <<'NOKEY'
The Stripe CLI has no test-mode key stored, so no price can be created.

Log in first, which opens a browser and stores a test key:

  pnpm stripe --login

If the CLI is already logged in under a different config directory, set the key
directly instead: put STRIPE_SECRET_KEY=sk_test_... in .env and run
`pnpm stripe` again.
NOKEY
    exit 1
  fi

  local currency
  currency="$(node -e 'process.stdout.write(require(process.argv[1]).currency)' "$fixtures")"

  local tiers="{" sep="" created=0 reused=0
  local tier name lookup amount seats workspaces document_bytes attachment_bytes price

  while IFS=$'\t' read -r tier name lookup amount seats workspaces document_bytes attachment_bytes; do
    price="$(stripe prices list -d "lookup_keys[]=$lookup" -d limit=1 | first_id)"
    if [ -n "$price" ]; then
      reused=$((reused + 1))
    else
      price="$(
        stripe prices create -c \
          -d "currency=$currency" \
          -d "unit_amount=$amount" \
          -d "recurring[interval]=month" \
          -d "product_data[name]=$name" \
          -d "lookup_key=$lookup" | first_id
      )"
      [ -n "$price" ] || die "Stripe created no price for $lookup"
      created=$((created + 1))
    fi
    tiers="$tiers$sep\"$price\":{\"tier\":\"$tier\",\"seats\":$seats,\"workspaces\":$workspaces,\"documentBytes\":$document_bytes,\"attachmentBytes\":$attachment_bytes}"
    sep=","
  done < <(
    node -e '
      const fixture = require(process.argv[1]);
      for (const plan of fixture.plans) {
        process.stdout.write(
          [plan.tier, plan.name, plan.lookupKey, plan.unitAmount, plan.seats, plan.workspaces, plan.documentBytes, plan.attachmentBytes].join("\t") + "\n",
        );
      }
    ' "$fixtures"
  )
  tiers="$tiers}"

  printf 'Prices: %s created, %s reused.\n\n' "$created" "$reused"
  cat <<ENV
Add these to the control plane's environment:

STRIPE_SECRET_KEY=$key
STRIPE_WEBHOOK_SECRET=<whsec_... from \`pnpm stripe --listen\`>
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
  --login) login ;;
  --listen) listen ;;
  --clock) clock ;;
  --help | -h) usage ;;
  *) usage >&2; exit 2 ;;
esac

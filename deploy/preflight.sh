#!/usr/bin/env bash
# Ask a host whether it can serve this deployment, before it is asked to.
#
# Every check here answers a failure that is otherwise *silent*: the process boots,
# `/health` says ok, and the thing that does not work is a verification mail nobody
# receives or a licence key that stops every claim. The failures that stop a boot on
# their own are not repeated here, because the boot already names them.
#
#   deploy/preflight.sh                 # reads ./.env
#   deploy/preflight.sh /etc/suite/env  # reads another file
#
# Exit status: 1 when a blocker is found, 0 otherwise. A note is a feature that will
# be absent, not a deployment that will not work. It needs nothing but a shell; the
# host it runs on has no Node.
set -uo pipefail

env_file=${1:-.env}
root=$(cd "$(dirname "$0")/.." && pwd)

blockers=0
notes=0

ok() { printf 'ok     %s\n' "$*"; }
note() {
  printf 'note   %s\n' "$*"
  notes=$((notes + 1))
}
blocker() {
  printf 'BLOCK  %s\n' "$*"
  blockers=$((blockers + 1))
}

[ -f "$root/$env_file" ] || [ -f "$env_file" ] || {
  echo "BLOCK  no $env_file; copy .env.example and fill it in" >&2
  exit 1
}
file=$env_file
[ -f "$root/$env_file" ] && file="$root/$env_file"

# Read one value without sourcing the file, so a stray `$(...)` in a comment cannot
# run and a duplicate key resolves the way compose resolves it: last one wins.
value() {
  sed -n -E "s/^[[:space:]]*$1=(.*)$/\1/p" "$file" | tail -n1 | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

echo "preflight: $file"
echo ""

# --- the file itself ------------------------------------------------------------
perms=$(stat -c '%a' "$file")
if [ "$perms" != "600" ] && [ "$perms" != "400" ]; then
  blocker "$env_file is mode $perms; it holds the auth secret and the database password (chmod 600)"
else
  ok "$env_file is mode $perms"
fi

# Two site blocks, one hostname is a Caddy error, not a preference: `adapt` refuses the
# whole config with "ambiguous site definition", so Caddy exits 1 having printed nothing
# beyond "using config from file". A hosted deployment names SUITE_APP_HOST; the
# single-host name stays for the self-host case.
domain=$(value SUITE_DOMAIN)
app_host=$(value SUITE_APP_HOST)
self_host=$(value SUITE_SELF_HOST)

if [ -n "$domain" ] && [ -n "$app_host" ] && [ "$domain" = "$app_host" ]; then
  blocker "SUITE_DOMAIN and SUITE_APP_HOST are both $domain, so Caddy refuses the config as an ambiguous site definition; keep SUITE_APP_HOST for a hosted app and drop SUITE_DOMAIN"
elif [ -z "$domain" ] && [ -z "$app_host" ]; then
  blocker "neither SUITE_DOMAIN nor SUITE_APP_HOST is set; Caddy has no hostname to serve or get a certificate for"
elif grep -qE '^[[:space:]]*SUITE_DOMAIN=(canvas\.example\.com)?[[:space:]]*$' "$file" && [ -z "$app_host" ]; then
  blocker "SUITE_DOMAIN is unset or still the example; Caddy would ask for a certificate it cannot get"
fi

# --- the identity stack ---------------------------------------------------------
auth_secret=$(value SUITE_AUTH_SECRET)
[ ${#auth_secret} -ge 32 ] ||
  blocker "SUITE_AUTH_SECRET is ${#auth_secret} characters; 32 or more, or sessions come from a guessable key"

database_url=$(value SUITE_CONTROL_PLANE_DATABASE_URL)
[ -n "${database_url:-$(value SUITE_AUTH_DATABASE_URL)}" ] ||
  blocker "SUITE_CONTROL_PLANE_DATABASE_URL is empty, so compose substitutes its own default, which names the \`postgres\` service that a managed-database host does not run"

db_url=${database_url:-$(value SUITE_AUTH_DATABASE_URL)}
case $db_url in
  *@postgres:* | *@postgres/*)
    blocker "the database URL names the compose service \`postgres\`, which this host does not run; use the RDS endpoint"
    ;;
  *sslmode=require* | *sslmode=verify-full*)
    ok "the database URL asks for TLS"
    ;;
  "")
    ;;
  *)
    note "the database URL does not set \`sslmode=require\`; a managed database sends the password in the clear without it"
    ;;
esac

admin_emails=$(value SUITE_ADMIN_EMAILS)
admission=$(value SUITE_ADMISSION_REQUIRED)
if [ -z "$admin_emails" ]; then
  blocker "SUITE_ADMIN_EMAILS is empty; nobody can reach the admissions queue or the panel, including you"
  [ "$admission" = "1" ] && blocker "SUITE_ADMISSION_REQUIRED=1 with no operator address; the boot refuses this pair"
fi

# --- the hosted set -------------------------------------------------------------
hosted=$(value SUITE_HOSTED)
if [ "$hosted" = "1" ]; then
  key=$(value SUITE_LICENCE_PUBLIC_KEY)
  if [ -z "$key" ]; then
    blocker "SUITE_HOSTED=1 needs SUITE_LICENCE_PUBLIC_KEY; the relay stops without it"
  else
    bytes=$(printf '%s' "$key" | base64 -d 2>/dev/null | wc -c)
    if [ "$bytes" -ne 32 ]; then
      blocker "SUITE_LICENCE_PUBLIC_KEY decodes to $bytes bytes, not 32; it is the raw key, not the PEM file"
    else
      ok "the licence public key is 32 bytes"
    fi
  fi

  settings_key=$(value SUITE_SETTINGS_KEY)
  if [ -z "$settings_key" ]; then
    blocker "SUITE_SETTINGS_KEY is empty; every save in /admin/settings answers 503 and no Stripe, Resend or Turnstile key can be stored"
  elif [ "$(printf '%s' "$settings_key" | wc -c)" -lt 32 ]; then
    blocker "SUITE_SETTINGS_KEY is shorter than 32 characters; openssl rand -base64 32 makes a usable one"
  else
    ok "the settings key can encrypt panel values"
  fi
fi

# --- channels that fail quietly -------------------------------------------------
mail=$(value SUITE_MAIL_TRANSPORT)
if [ -z "$mail" ] || [ "$mail" = "console" ]; then
  note "SUITE_MAIL_TRANSPORT is \`console\`; a verification link is printed to the container log and never delivered, so nobody can finish signing up"
else
  ok "mail goes out through \`$mail\`"
  case $mail in
    resend) [ -n "$(value RESEND_API_KEY)" ] || blocker "SUITE_MAIL_TRANSPORT=resend without RESEND_API_KEY" ;;
    smtp) [ -n "$(value SUITE_SMTP_URL)" ] || blocker "SUITE_MAIL_TRANSPORT=smtp without SUITE_SMTP_URL" ;;
  esac
  [ -n "$(value SUITE_MAIL_FROM)" ] ||
    note "SUITE_MAIL_FROM is empty; most providers reject a message with no From, and a rejected verification mail reads as a bad address"
fi

if [ -n "$(value SUITE_TURNSTILE_SECRET)" ] && [ -z "$(value SUITE_TURNSTILE_SITE_KEY)" ]; then
  blocker "a Turnstile secret is set but the site key is not; the form asks for no challenge, so no sign-up can satisfy one"
fi
[ -n "$(value SUITE_TURNSTILE_SITE_KEY)" ] && [ -z "$(value SUITE_TURNSTILE_SECRET)" ] &&
  note "a Turnstile site key is set but no secret; the widget renders and the server ignores it"

billing=$(value SUITE_BILLING_ENABLED)
if [ "$billing" = "1" ] && [ -z "$(value STRIPE_SECRET_KEY)" ]; then
  note "SUITE_BILLING_ENABLED=1 with no STRIPE_SECRET_KEY; the panel can hold one instead, so this is only a note"
fi

# --- the machine ----------------------------------------------------------------
if [ -n "$(value COMPOSE_FILE)" ]; then
  ok "compose merges $(value COMPOSE_FILE)"
else
  note "COMPOSE_FILE is unset; a host that logs to CloudWatch needs \`compose.yaml:deploy/compose.aws.yaml\` here, or the overlay is lost on the first upgrade"
fi

for port in 80 443; do
  if command -v ss >/dev/null 2>&1 && ss -ltn "sport = :$port" 2>/dev/null | grep -q LISTEN; then
    note "something already listens on :$port; Caddy will not bind until it stops"
  fi
done

mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0)
if [ "${mem_kb:-0}" -gt 0 ] && [ "$mem_kb" -lt 3800000 ]; then
  note "$((mem_kb / 1024)) MiB of memory; the on-host build needs about 4 GiB, so add swap or build elsewhere (docs/how-to/deploy.md §9)"
fi

if [ -d /srv/backups ]; then
  [ -w /srv/backups ] || note "/srv/backups is not writable; deploy/backup.sh will refuse"
else
  note "/srv/backups does not exist; deploy/backup.sh writes there"
fi

echo ""
if [ "$blockers" -gt 0 ]; then
  echo "$blockers blocker(s) and $notes note(s). A blocker stops the deployment working; a note is a feature that will be absent."
  exit 1
fi
echo "No blockers. $notes note(s)."

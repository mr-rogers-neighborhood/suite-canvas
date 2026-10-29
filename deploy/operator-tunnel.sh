#!/usr/bin/env bash
# Open the operator panel on a deployed host, from a workstation.
#
# `/admin*`, `/metrics` and `/api/admin*` are served only to the networks in
# `SUITE_OPERATOR_ALLOW`, which on a deployed host does not include the public internet.
# That is deliberate: the panel holds the Stripe, Resend and Turnstile secrets, and the
# session it mints can act as any account.
#
# A tunnel terminates on the host's own loopback and is forwarded from there, so the panel
# answers exactly as it would to a request made on the box. Nothing about the security group
# changes, and port 22 stays the only extra rule.
#
#   deploy/operator-tunnel.sh                      # opens https://127.0.0.1:8443
#   deploy/operator-tunnel.sh --host <instance public ip>   # or SUITE_TUNNEL_HOST
#   deploy/operator-tunnel.sh --port 9443
#   deploy/operator-tunnel.sh --print              # the curl to paste, without the tunnel
#
# Leave it running in one terminal and use the printed URL in a browser. The certificate is
# the real one for the hostname, so `--resolve` is the only trick needed: no warning page,
# no `-k`.
set -euo pipefail

host=${SUITE_TUNNEL_HOST:-}
port=${SUITE_TUNNEL_PORT:-8443}
user=${SUITE_TUNNEL_USER:-ubuntu}
identity=${SUITE_TUNNEL_KEY:-$HOME/.ssh/id_rsa}
print_only=0
domain=${SUITE_APP_HOST:-app.suite.run}

die() {
  printf 'operator-tunnel: %s\n' "$1" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --host) host="${2:?--host needs a value}"; shift 2 ;;
    --port) port="${2:?--port needs a value}"; shift 2 ;;
    --user) user="${2:?--user needs a value}"; shift 2 ;;
    --key) identity="${2:?--key needs a value}"; shift 2 ;;
    --domain) domain="${2:?--domain needs a value}"; shift 2 ;;
    --print) print_only=1; shift ;;
    -h | --help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$host" ] || die "no host; pass --host or set SUITE_TUNNEL_HOST (the Elastic IP or DNS name of the instance)"
[ -f "$identity" ] || die "no key at $identity; pass --key or set SUITE_TUNNEL_KEY"

url="https://$domain:$port/admin.html"

if [ "$print_only" = 1 ]; then
  printf 'ssh -N -L %s:127.0.0.1:443 %s@%s -i %s\n' "$port" "$user" "$host" "$identity"
  printf 'curl --resolve %s:%s:127.0.0.1 %s\n' "$domain" "$port" "$url"
  exit 0
fi

printf 'Forwarding 127.0.0.1:%s to %s:443 as %s@%s.\n\n' "$port" "$domain" "$user" "$host"
printf '  1. open %s\n' "$url"
printf '     (the browser must resolve %s to 127.0.0.1: add the hosts line below, or use the curl)\n' "$domain"
printf '       127.0.0.1 %s\n\n' "$domain"
printf '  2. or ask for the page with curl:\n'
printf '       curl --resolve %s:%s:127.0.0.1 %s\n\n' "$domain" "$port" "$url"
printf 'Ctrl-C closes the tunnel. The panel is still refused from the public internet.\n\n'

exec ssh -N -o ExitOnForwardFailure=yes -L "$port:127.0.0.1:443" "$user@$host" -i "$identity"

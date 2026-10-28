#!/usr/bin/env bash
# Put the Amazon RDS CA bundle where the control plane can trust it.
#
# Why this is needed at all: RDS signs its endpoint certificate with a CA that no Node
# image carries, and `pg` reads `sslmode=require` as `verify-full`. Without the bundle the
# control plane reports `503 checks:[{name:"database",state:"failed",
# detail:"self-signed certificate in certificate chain"}]` and sign-in never works. The
# alternative — `uselibpqcompat=true&sslmode=require` — turns verification off entirely,
# which is the wrong trade for a database holding accounts.
#
# The bundle is a public download of ~114 certificates; the file is mounted into the
# container and Node adds it to its trust store through `NODE_EXTRA_CA_CERTS`.
#
#   sudo deploy/rds-ca.sh                 # writes /etc/suite/rds-global-bundle.pem
#   sudo deploy/rds-ca.sh /other/path.pem # or somewhere else
#
# Run it on the host, and again when AWS rotates the bundle (they announce it months ahead).
set -euo pipefail

destination=${1:-/etc/suite/rds-global-bundle.pem}
source_url=https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

die() {
  printf 'rds-ca: %s\n' "$1" >&2
  exit 1
}

command -v curl >/dev/null 2>&1 || die "curl is not installed"

install_dir=$(dirname "$destination")
mkdir -p "$install_dir"

temporary=$(mktemp)
trap 'rm -f "$temporary"' EXIT

curl -fsSL "$source_url" -o "$temporary" || die "could not download $source_url"

# A truncated download is the failure that would look like a working file: count the
# certificates rather than trusting the exit status alone.
count=$(grep -c 'BEGIN CERTIFICATE' "$temporary" || true)
[ "${count:-0}" -ge 100 ] || die "downloaded bundle holds $count certificates, expected 100 or more"

install -m 644 "$temporary" "$destination"
printf 'rds-ca: %s certificates written to %s\n' "$count" "$destination"
printf 'rds-ca: the control plane reads it through NODE_EXTRA_CA_CERTS; restart it to pick it up\n'

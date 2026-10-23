#!/usr/bin/env bash
# Restore one deploy/backup.sh snapshot into the compose `suite-data` volume.
#
# Order matters: verify the snapshot, stop `app`, replace the three databases
# together, start `app`, then require /health to answer. The volume is left
# untouched unless the manifest and every integrity_check pass.
#
# Usage:
#   deploy/restore.sh <snapshot-directory> [--force | --verify-only]
#
#   --force        restore over a volume that already holds data. Without it, a
#                  non-empty volume is refused: the usual accident is running a
#                  restore on the wrong host, which would overwrite live data.
#   --verify-only  run the manifest and integrity_check pass and stop. This is
#                  the safe monthly drill: it reads the snapshot and nothing else.
#
# Environment:
#   SUITE_DATA_VOLUME   Docker volume to restore into. Resolved from the `app`
#                       container, then from compose labels, then `suite_suite-data`.
#   SUITE_HEALTH_URL    optional URL to curl after the restart, e.g.
#                       https://canvas.example.com/health. Default: run curl in
#                       the app container's network namespace (port 1235).
#   SUITE_RESTORE_IMAGE helper image with a shell (default: alpine:3)
#   SUITE_CURL_IMAGE    image used for the /health check (default: curlimages/curl:8)
#   SUITE_HEALTH_TIMEOUT seconds to wait for health (default: 90)
#
# The snapshot holds five stores: documents, shares and workspaces, plus the
# operator's runtime settings (limit overrides) and the hosted licence claims.
# The last two matter: restoring without them silently reverts quotas and
# unlinks paid workspaces from their licence. Snapshots taken before they were
# added still restore; the missing entries are simply skipped.
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/{/^set -euo/d;p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

SNAPSHOT=""
FORCE=0
VERIFY_ONLY=0
for argument in "$@"; do
  case "$argument" in
    -h | --help)
      usage
      exit 0
      ;;
    --force)
      FORCE=1
      ;;
    --verify-only)
      VERIFY_ONLY=1
      ;;
    -*)
      die "unknown option: $argument (accepted: --force, --verify-only, --help)"
      ;;
    *)
      [ -z "$SNAPSHOT" ] || die "only one snapshot directory may be given"
      SNAPSHOT=$argument
      ;;
  esac
done

[ -n "$SNAPSHOT" ] || {
  usage >&2
  exit 2
}

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

HELPER_IMAGE=${SUITE_RESTORE_IMAGE:-alpine:3}
CURL_IMAGE=${SUITE_CURL_IMAGE:-curlimages/curl:8}
HEALTH_TIMEOUT=${SUITE_HEALTH_TIMEOUT:-90}

command -v docker >/dev/null 2>&1 || die "docker is required (the restore replaces a volume)."

SNAPSHOT=$(cd "$SNAPSHOT" && pwd) || die "snapshot directory not found"
MANIFEST="$SNAPSHOT/manifest.txt"
[ -f "$MANIFEST" ] || die "$SNAPSHOT/manifest.txt is missing; point at a backup.sh snapshot."

# ---------------------------------------------------------------- verification

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    printf 'unavailable'
  fi
}

integrity_check() {
  local file=$1
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$file" "PRAGMA integrity_check;"
    return
  fi
  # No sqlite3 on the host: run the same check in a throwaway container.
  local name
  name=$(basename "$file")
  docker run --rm -v "$SNAPSHOT":/snapshot:ro "$HELPER_IMAGE" \
    sh -c "apk add --no-cache sqlite >/dev/null 2>&1 && sqlite3 '/snapshot/$name' 'PRAGMA integrity_check;'"
}

STORES=()
while IFS=$'\t' read -r kind name _source bytes checksum; do
  [ "$kind" = "file" ] || continue
  [ "$name" = "name" ] && continue # the manifest's column header
  case "$name" in
    documents | shares | workspaces | settings | licences) ;;
    *)
      printf 'warning: ignoring unexpected entry "%s" in the manifest\n' "$name" >&2
      continue
      ;;
  esac
  file="$SNAPSHOT/$name.sqlite"
  if [ ! -f "$file" ]; then
    die "the manifest lists $name.sqlite but $file is missing"
  fi
  if [ -n "$bytes" ] && [ "$bytes" != "missing" ]; then
    actual=$(stat -c %s "$file" 2>/dev/null || stat -f %z "$file")
    [ "$actual" = "$bytes" ] || die "$name.sqlite is $actual bytes; the manifest says $bytes"
  fi
  if [ -n "$checksum" ] && [ "$checksum" != "-" ] && [ "$checksum" != "unavailable" ]; then
    actual=$(sha256_of "$file")
    if [ "$actual" != "unavailable" ] && [ "$actual" != "$checksum" ]; then
      die "$name.sqlite has sha256 $actual; the manifest says $checksum"
    fi
  fi
  result=$(integrity_check "$file")
  [ "$result" = "ok" ] || die "$name.sqlite failed integrity_check: $result"
  printf '  verified  %s (%s bytes, integrity ok)\n' "$name.sqlite" "$bytes"
  STORES+=("$name")
done <"$MANIFEST"

[ "${#STORES[@]}" -gt 0 ] || die "the manifest lists no documents, shares or workspaces snapshot."

if [ "$VERIFY_ONLY" = "1" ]; then
  printf 'snapshot  %s is consistent; nothing was written\n' "$SNAPSHOT"
  exit 0
fi

# ------------------------------------------------------------------- the volume

VOLUME=${SUITE_DATA_VOLUME:-}
if [ -z "$VOLUME" ]; then
  container=$(docker compose ps -aq app 2>/dev/null | head -n1 || true)
  if [ -n "$container" ]; then
    VOLUME=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' \
      "$container" 2>/dev/null || true)
  fi
fi
if [ -z "$VOLUME" ]; then
  VOLUME=$(docker volume ls -q \
    --filter "label=com.docker.compose.project=suite" \
    --filter "label=com.docker.compose.volume=suite-data" 2>/dev/null | head -n1 || true)
fi
VOLUME=${VOLUME:-suite_suite-data}

docker volume inspect "$VOLUME" >/dev/null 2>&1 ||
  die "volume \"$VOLUME\" does not exist. Set SUITE_DATA_VOLUME to the volume holding /data."

printf 'volume    %s\n' "$VOLUME"

volume_has_data() {
  docker run --rm -v "$VOLUME":/data:ro "$HELPER_IMAGE" sh -c '
    for entry in /data/*; do
      [ -e "$entry" ] || continue
      case "$(basename "$entry")" in lost+found) continue ;; esac
      exit 0
    done
    exit 1'
}

if volume_has_data; then
  if [ "$FORCE" != "1" ]; then
    cat >&2 <<EOF
error: $VOLUME already holds data.

Restoring replaces the live databases. Re-run with --force when that is what
you mean (wrong host is the usual accident):

  deploy/restore.sh "$SNAPSHOT" --force
EOF
    exit 1
  fi
  printf 'warning: %s is not empty; replacing it because --force was given\n' "$VOLUME" >&2
fi

# ------------------------------------------------------------------ the restore

restart_app() {
  # `start` keeps the existing container (and its IP, which Caddy caches);
  # `up -d` only creates it when it does not exist yet.
  docker compose start app >/dev/null 2>&1 || docker compose up -d app
}

trap 'printf "warning: app is stopped; fix the problem, then run: docker compose -f %s/compose.yaml up -d app\n" "$ROOT_DIR" >&2' ERR

printf 'stopping app...\n'
docker compose stop app >/dev/null 2>&1 || true

printf 'copying %s into %s...\n' "${STORES[*]}" "$VOLUME"
docker run --rm \
  -e STORES="${STORES[*]}" \
  -v "$VOLUME":/data \
  -v "$SNAPSHOT":/snapshot:ro \
  "$HELPER_IMAGE" sh -c '
    set -eu
    for name in $STORES; do
      [ -f "/snapshot/$name.sqlite" ] || continue
      # Stale -wal/-shm beside a replaced main file is the classic restore bug.
      rm -f "/data/$name.sqlite" "/data/$name.sqlite-wal" "/data/$name.sqlite-shm" "/data/$name.sqlite-journal"
      cp "/snapshot/$name.sqlite" "/data/$name.sqlite"
    done
    ls -l /data'

printf 'starting app...\n'
restart_app
trap - ERR

# --------------------------------------------------------------------- the check

elapsed=0
health=""
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  if [ -n "${SUITE_HEALTH_URL:-}" ]; then
    if command -v curl >/dev/null 2>&1; then
      health=$(curl -fsS --max-time 5 "$SUITE_HEALTH_URL" 2>/dev/null || true)
    else
      health=$(docker run --rm --network host "$CURL_IMAGE" \
        -fsS --max-time 5 "$SUITE_HEALTH_URL" 2>/dev/null || true)
    fi
  else
    container=$(docker compose ps -q app 2>/dev/null | head -n1 || true)
    if [ -n "$container" ]; then
      health=$(docker run --rm --network "container:$container" "$CURL_IMAGE" \
        -fsS --max-time 5 http://127.0.0.1:1235/health 2>/dev/null || true)
    fi
  fi
  [ -n "$health" ] && break
  sleep 2
  elapsed=$((elapsed + 2))
  printf '.'
done
printf '\n'

if [ -z "$health" ]; then
  cat >&2 <<EOF
error: /health did not answer within ${HEALTH_TIMEOUT}s.

Inspect the logs before touching the data:

  docker compose logs --tail=100 app

A startup failure usually names the variable at fault (boot-time validation); a
journal-mode or permission error points at the copied files.
EOF
  exit 1
fi

printf 'health    %s\n' "$health"
cat <<EOF

Restore complete. Check next:

  curl -s -H "Authorization: Bearer \$SUITE_ADMIN_TOKEN" http://127.0.0.1:1235/api/admin/status
  docker compose exec app ls -l /data

settings.sqlite (runtime limit overrides) is not part of a snapshot and was
left untouched; recreate any overrides in the /admin panel if the restore was
meant to reset them too.
EOF

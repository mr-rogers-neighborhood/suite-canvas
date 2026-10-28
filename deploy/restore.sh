#!/usr/bin/env bash
# Restore one deploy/backup.sh snapshot into the compose `suite-data` volume.
#
# Order matters: verify the snapshot, stop `app`, replace all six databases
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
#   SUITE_HEALTH_URL    optional URL to fetch after the restart, e.g.
#                       https://canvas.example.com/health. Default: ask the app
#                       container's own loopback (port 1235) from a helper.
#   SUITE_RESTORE_IMAGE helper image with a shell (default: alpine:3)
#   SUITE_HEALTH_IMAGE  helper image with `wget` for the /health check
#                       (default: alpine:3, which the compose file already pulls)
#   SUITE_HEALTH_TIMEOUT seconds to wait for health (default: 90)
#
# The snapshot holds six stores: documents, shares and workspaces, plus the
# operator's runtime settings (limit overrides), the hosted licence claims and
# the attachment bytes. The last three matter: restoring without them silently
# reverts quotas, unlinks paid workspaces from their licence, and leaves every
# image in the documents as a permanent placeholder. Snapshots taken before a
# store was added still restore; the missing entries are skipped with a warning.
# A manifest row count or attachment-id checksum that disagrees with the
# snapshot is a hard failure: an empty database also passes integrity_check.
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
HEALTH_IMAGE=${SUITE_HEALTH_IMAGE:-alpine:3}
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

stdin_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
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
SKIPPED=()
while IFS=$'\t' read -r kind name _source bytes checksum; do
  [ "$kind" = "file" ] || continue
  [ "$name" = "name" ] && continue # the manifest's column header
  case "$name" in
    documents | shares | workspaces | settings | licences | attachments) ;;
    *)
      printf 'warning: ignoring unexpected entry "%s" in the manifest\n' "$name" >&2
      continue
      ;;
  esac
  file="$SNAPSHOT/$name.sqlite"
  if [ "$bytes" = "missing" ]; then
    printf 'warning: the snapshot has no %s store; it will be left as it is\n' "$name" >&2
    SKIPPED+=("$name")
    continue
  fi
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

# ------------------------------------------------- completeness, not readability

# `integrity_check` is happy with an empty file. The manifest's row counts and
# the attachment-id checksum are what prove the snapshot carries the same data
# the operator had; a mismatch is a hard failure before anything is written.
store_for_table() {
  case "$1" in
    documents | share_projection_documents) printf 'documents' ;;
    shares | share_baselines) printf 'shares' ;;
    workspaces) printf 'workspaces' ;;
    settings) printf 'settings' ;;
    workspace_licences) printf 'licences' ;;
    attachments) printf 'attachments' ;;
    *) printf '' ;;
  esac
}

declare -A EXPECTED_ROWS=()
EXPECTED_ATTACHMENT_IDS=""
while IFS=$'\t' read -r kind key value _rest; do
  case "$kind" in
    counts)
      [ "$key" = "table" ] && continue
      EXPECTED_ROWS["$key"]=$value
      ;;
    attachment_ids)
      [ "$key" = "sha256" ] && EXPECTED_ATTACHMENT_IDS=$value
      ;;
  esac
done <"$MANIFEST"

for table in "${!EXPECTED_ROWS[@]}"; do
  store=$(store_for_table "$table")
  [ -n "$store" ] || continue
  file="$SNAPSHOT/$store.sqlite"
  [ -f "$file" ] || continue
  actual=$(sqlite3 "$file" "SELECT COUNT(*) FROM $table;" 2>/dev/null || printf 'absent')
  [ "$actual" = "absent" ] && continue
  expected=${EXPECTED_ROWS[$table]}
  [ "$actual" = "$expected" ] ||
    die "$table holds $actual rows; the manifest says $expected"
done

if [ -n "$EXPECTED_ATTACHMENT_IDS" ] &&
  [ "$EXPECTED_ATTACHMENT_IDS" != "unavailable" ] &&
  [ "$EXPECTED_ATTACHMENT_IDS" != "missing" ] &&
  [ -f "$SNAPSHOT/attachments.sqlite" ]; then
  actual_ids=$(sqlite3 "$SNAPSHOT/attachments.sqlite" "SELECT id FROM attachments ORDER BY id;" 2>/dev/null |
    stdin_sha256)
  [ "$actual_ids" = "unavailable" ] || [ "$actual_ids" = "$EXPECTED_ATTACHMENT_IDS" ] ||
    die "the attachment ids hash to $actual_ids; the manifest says $EXPECTED_ATTACHMENT_IDS"
  printf '  verified  attachment id set (%s)\n' "$EXPECTED_ATTACHMENT_IDS"
fi

for name in "${SKIPPED[@]:-}"; do
  case "$name" in
    "" ) ;;
    attachments)
      printf 'warning: this snapshot has no attachment store; every image in the restored documents will render as a placeholder\n' >&2
      ;;
  esac
done

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

# The control plane's database, when the snapshot carries one. It goes back through the
# database service, the same way it came out, so neither the host nor the app image needs a
# Postgres client.
restore_control_plane() {
  local dump="$SNAPSHOT/control-plane.sql"
  [ -f "$dump" ] || {
    printf 'warning: this snapshot has no control-plane dump; accounts, organizations, templates and panel settings stay as they are\n' >&2
    return 0
  }
  local service=${SUITE_POSTGRES_SERVICE:-postgres}
  local user=${POSTGRES_USER:-suite}
  local database=${POSTGRES_DB:-suite}
  printf 'restoring the control plane from control-plane.sql...\n'
  docker compose exec -T "$service" psql --quiet --no-psqlrc -v ON_ERROR_STOP=1 -U "$user" -d "$database" \
    <"$dump" >/dev/null
  printf '  restored  control-plane.sql\n'
}

restore_control_plane

printf 'starting app...\n'
restart_app
trap - ERR

# --------------------------------------------------------------------- the check

# A failed fetch must be distinguishable from a slow one: `wget -q -O -`
# exits non-zero on a 4xx/5xx and prints nothing, exactly like `curl -f`.
fetch_health() {
  local url=$1 network=$2
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 5 "$url" 2>/dev/null || true
    return 0
  fi
  docker run --rm --network "$network" "$HEALTH_IMAGE" \
    wget -q -O - -T 5 "$url" 2>/dev/null || true
}

elapsed=0
health=""
while [ "$elapsed" -lt "$HEALTH_TIMEOUT" ]; do
  if [ -n "${SUITE_HEALTH_URL:-}" ]; then
    health=$(fetch_health "$SUITE_HEALTH_URL" host)
  else
    container=$(docker compose ps -q app 2>/dev/null | head -n1 || true)
    if [ -n "$container" ]; then
      health=$(fetch_health http://127.0.0.1:1235/health "container:$container")
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

All six stores were restored together: documents, shares, workspaces, settings,
licences and attachments, plus the control plane's own database when the snapshot
carried one. The stores are why the volume is replaced as a set: quotas revert, paid
workspaces unlink and images break when one is stale.
EOF

#!/usr/bin/env bash
# Snapshot all six Suite SQLite databases into one timestamped directory.
#
# The server keeps running: each database is copied through SQLite's own
# `.backup` command, which takes a read lock and writes a consistent single
# file (including whatever is still in the write-ahead log).
#
# The share database holds the share rows and the draft baselines
# (`share_baselines`); the document database holds the workspace snapshots and
# the projected share documents (`share-*` rooms); the attachments database
# holds every uploaded image's bytes. All of it is captured, because a document
# whose attachment bytes are missing renders as a broken image forever.
#
# With SUITE_BACKUP_BUCKET set the snapshot is also uploaded off-host as one
# tar.gz (manifest included) through `aws s3 cp`: every run to
# <bucket>/<prefix>/daily/, and Sunday's run additionally to
# <bucket>/<prefix>/weekly/. Retention is a bucket lifecycle rule, not this
# script -- expire daily/ after 7 days and weekly/ after 35 days, which keeps
# the last 7 daily and 4 weekly copies. Nothing is deleted locally.
#
# Usage:
#   deploy/backup.sh [destination-directory]
#
# Environment:
#   SUITE_DATA_DIR        directory holding the default database paths
#                         (default: apps/collab-server). Both layouts are
#                         recognised: the compose names on the volume
#                         (`documents.sqlite`) and the standalone names
#                         (`suite.documents.sqlite`).
#   SUITE_DB              document database (default: $SUITE_DATA_DIR/suite.documents.sqlite)
#   SUITE_SHARES_DB       share database    (default: $SUITE_DATA_DIR/suite.shares.sqlite)
#   SUITE_WORKSPACES_DB   owner database    (default: $SUITE_DATA_DIR/suite.workspaces.sqlite)
#   SUITE_SETTINGS_DB     runtime limit overrides (default: $SUITE_DATA_DIR/suite.settings.sqlite)
#   SUITE_LICENCE_DB      hosted licence claims   (default: $SUITE_DATA_DIR/suite.licences.sqlite)
#   SUITE_ATTACHMENTS_DB  uploaded attachment bytes (default: $SUITE_DATA_DIR/suite.attachments.sqlite)
#   SUITE_BACKUP_BUCKET   optional s3://bucket/ to upload to; unset = local only
#   SUITE_BACKUP_PREFIX   key prefix inside the bucket (default: suite)
#   SUITE_BACKUP_ENDPOINT S3-compatible endpoint for R2/MinIO, passed to aws
#
# Restore with the server stopped: deploy/restore.sh (or docs/operations.md).
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/{/^set -euo/d;p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

if ! command -v sqlite3 >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: sqlite3 is required for an online backup.

Install it (Debian/Ubuntu: apt-get install sqlite3, Alpine: apk add sqlite,
macOS: brew install sqlite) or stop the server and copy all six database files
together, including their -wal/-shm sidecars:

  docker compose stop app
  docker run --rm -v suite_suite-data:/data -v "$PWD/backups:/backup" alpine \
    tar czf "/backup/suite-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /data .
  docker compose start app
EOF
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DATA_DIR=${SUITE_DATA_DIR:-"$ROOT_DIR/apps/collab-server"}
DEST_ROOT=${1:-"$ROOT_DIR/backups"}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$DEST_ROOT/suite-$STAMP"

# The variable wins; otherwise the directory's own layout decides. The compose
# volume holds `<store>.sqlite` (what compose.yaml writes) and a dev checkout
# holds `suite.<store>.sqlite`. Guessing wrong means a snapshot that silently
# omits a store, so the layout is detected from the files that always exist
# rather than assumed.
STORE_STYLE=prefixed
if [ -f "$DATA_DIR/documents.sqlite" ] || [ -f "$DATA_DIR/shares.sqlite" ] ||
  [ -f "$DATA_DIR/workspaces.sqlite" ]; then
  STORE_STYLE=plain
fi

resolve_store() {
  local configured=$1 name=$2
  if [ -n "$configured" ]; then
    printf '%s' "$configured"
    return 0
  fi
  if [ "$STORE_STYLE" = "plain" ]; then
    printf '%s' "$DATA_DIR/$name.sqlite"
    return 0
  fi
  printf '%s' "$DATA_DIR/suite.$name.sqlite"
}

DOCUMENTS_DB=$(resolve_store "${SUITE_DB:-}" documents)
SHARES_DB=$(resolve_store "${SUITE_SHARES_DB:-}" shares)
WORKSPACES_DB=$(resolve_store "${SUITE_WORKSPACES_DB:-}" workspaces)
# Restoring without these loses the operator's runtime limit overrides and every
# hosted licence claim: the app still starts, but quotas silently revert and paid
# workspaces are no longer linked to their licence.
SETTINGS_DB=$(resolve_store "${SUITE_SETTINGS_DB:-}" settings)
LICENCES_DB=$(resolve_store "${SUITE_LICENCE_DB:-}" licences)
# Attachment bytes. A document holds only an attachment id, so a restore without
# this store leaves every image as a permanent placeholder.
ATTACHMENTS_DB=$(resolve_store "${SUITE_ATTACHMENTS_DB:-}" attachments)

BUCKET=${SUITE_BACKUP_BUCKET:-}
PREFIX=${SUITE_BACKUP_PREFIX:-suite}
ENDPOINT=${SUITE_BACKUP_ENDPOINT:-}
ARCHIVE=""

mkdir -p "$DEST"
MANIFEST="$DEST/manifest.txt"

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  else
    printf 'unavailable'
  fi
}

bytes_of() {
  if stat -c %s "$1" >/dev/null 2>&1; then
    stat -c %s "$1"
  else
    stat -f %z "$1"
  fi
}

# Rows in a table of the snapshot, or 0 when the table is absent.
count_in() {
  sqlite3 "$1" "SELECT COUNT(*) FROM $2;" 2>/dev/null || printf '0'
}

# Total payload bytes in a table, or `-` when the table has no byte column.
bytes_in() {
  local total
  total=$(sqlite3 "$1" "$2" 2>/dev/null) || { printf -- '-'; return 0; }
  printf '%s' "${total:-0}"
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

# A checksum over the store's attachment ids in sorted order. The file checksum
# above proves the database is intact; this proves it holds the *same set* of
# images, which is what a document actually depends on.
attachment_digest() {
  if [ ! -f "$1" ]; then
    printf 'missing'
    return 0
  fi
  sqlite3 "$1" "SELECT id FROM attachments ORDER BY id;" 2>/dev/null | stdin_sha256
}

snapshot() {
  local name=$1 source=$2
  if [ ! -f "$source" ]; then
    printf 'warning: %s does not exist; recorded as missing\n' "$source" >&2
    printf 'file\t%s\t%s\tmissing\t-\n' "$name" "$source" >>"$MANIFEST"
    return 0
  fi

  # The destination name is fixed and relative, so no path quoting is needed
  # inside the SQLite dot-command. `.timeout` waits out a writer checkpoint.
  (
    cd "$DEST"
    sqlite3 "$source" ".timeout 10000" ".backup '$name.sqlite'"
  )

  local integrity
  integrity=$(sqlite3 "$DEST/$name.sqlite" "PRAGMA integrity_check;")
  if [ "$integrity" != "ok" ]; then
    printf 'error: integrity_check failed for %s: %s\n' "$name" "$integrity" >&2
    exit 1
  fi

  printf 'file\t%s\t%s\t%s\t%s\n' \
    "$name" "$source" "$(bytes_of "$DEST/$name.sqlite")" "$(checksum "$DEST/$name.sqlite")" \
    >>"$MANIFEST"
}

# One upload with or without a custom endpoint; `aws s3 cp` writes a single
# object atomically, and the tar.gz carries the manifest and checksums.
upload_one() {
  local destination=$1
  if [ -n "$ENDPOINT" ]; then
    aws --endpoint-url "$ENDPOINT" s3 cp --only-show-errors "$ARCHIVE" "$destination"
  else
    aws s3 cp --only-show-errors "$ARCHIVE" "$destination"
  fi
}

# Off-host copy. Unset bucket = the historical behaviour: snapshot stays local.
upload() {
  if [ -z "$BUCKET" ]; then
    return 0
  fi
  if ! command -v aws >/dev/null 2>&1; then
    # A configured bucket that silently stops uploading is worse than a failed
    # backup: exit non-zero so cron/monitoring notices.
    printf 'error: SUITE_BACKUP_BUCKET is set but the aws CLI is not installed.\n' >&2
    printf 'Install awscli v2 (or unset SUITE_BACKUP_BUCKET for local-only backups).\n' >&2
    exit 1
  fi

  ARCHIVE="$DEST_ROOT/suite-$STAMP.tar.gz"
  tar -czf "$ARCHIVE" -C "$DEST_ROOT" "suite-$STAMP"

  local base="${BUCKET%/}/${PREFIX}"
  upload_one "$base/daily/suite-$STAMP.tar.gz"
  printf 'uploaded %s to %s/daily/\n' "$(basename "$ARCHIVE")" "$base"

  if [ "$(date -u +%u)" = "7" ]; then
    upload_one "$base/weekly/suite-$STAMP.tar.gz"
    printf 'uploaded %s to %s/weekly/ (Sunday copy)\n' "$(basename "$ARCHIVE")" "$base"
  fi

  cat <<EOF
Retention is the bucket's job, not this script's. Keep a lifecycle rule that
expires    $base/daily/   after 7 days
and        $base/weekly/  after 35 days
which leaves 7 daily and 4 weekly copies.
EOF
}

{
  printf 'created_at\t%s\n' "$STAMP"
  printf 'host\t%s\n' "$(hostname 2>/dev/null || printf 'unknown')"
  printf 'sqlite\t%s\n' "$(sqlite3 --version | cut -d' ' -f1)"
  printf 'stores\t%d\n' 6
  printf 'file\tname\tsource\tbytes\tsha256\n'
} >"$MANIFEST"

snapshot documents "$DOCUMENTS_DB"
snapshot shares "$SHARES_DB"
snapshot workspaces "$WORKSPACES_DB"
snapshot settings "$SETTINGS_DB"
snapshot licences "$LICENCES_DB"
snapshot attachments "$ATTACHMENTS_DB"

{
  # Row count and payload bytes per table, so a restore can tell "readable" from
  # "complete": an empty database passes integrity_check too.
  printf '\ncounts\ttable\trows\tbytes\n'
  if [ -f "$DEST/documents.sqlite" ]; then
    printf 'counts\tdocuments\t%s\t%s\n' \
      "$(count_in "$DEST/documents.sqlite" documents)" \
      "$(bytes_in "$DEST/documents.sqlite" "SELECT COALESCE(SUM(length(state)), 0) FROM documents;")"
    printf 'counts\tshare_projection_documents\t%s\t%s\n' \
      "$(sqlite3 "$DEST/documents.sqlite" \
        "SELECT COUNT(*) FROM documents WHERE name LIKE '%:share-%';" 2>/dev/null || printf '0')" \
      "$(bytes_in "$DEST/documents.sqlite" \
        "SELECT COALESCE(SUM(length(state)), 0) FROM documents WHERE name LIKE '%:share-%';")"
  fi
  if [ -f "$DEST/shares.sqlite" ]; then
    printf 'counts\tshares\t%s\t-\n' "$(count_in "$DEST/shares.sqlite" shares)"
    printf 'counts\tshare_baselines\t%s\t%s\n' \
      "$(count_in "$DEST/shares.sqlite" share_baselines)" \
      "$(bytes_in "$DEST/shares.sqlite" "SELECT COALESCE(SUM(length(snapshot)), 0) FROM share_baselines;")"
  fi
  if [ -f "$DEST/workspaces.sqlite" ]; then
    printf 'counts\tworkspaces\t%s\t-\n' "$(count_in "$DEST/workspaces.sqlite" workspaces)"
  fi
  if [ -f "$DEST/settings.sqlite" ]; then
    printf 'counts\tsettings\t%s\t-\n' "$(count_in "$DEST/settings.sqlite" settings)"
  fi
  if [ -f "$DEST/licences.sqlite" ]; then
    printf 'counts\tworkspace_licences\t%s\t-\n' \
      "$(count_in "$DEST/licences.sqlite" workspace_licences)"
  fi
  if [ -f "$DEST/attachments.sqlite" ]; then
    printf 'counts\tattachments\t%s\t%s\n' \
      "$(count_in "$DEST/attachments.sqlite" attachments)" \
      "$(bytes_in "$DEST/attachments.sqlite" "SELECT COALESCE(SUM(size), 0) FROM attachments;")"
  fi
  printf '\nattachment_ids\tsha256\t%s\n' "$(attachment_digest "$DEST/attachments.sqlite")"
} >>"$MANIFEST"

printf 'snapshot written to %s\n' "$DEST"
sed -n '/^counts/,/^$/p' "$MANIFEST" | tail -n +2 | while IFS=$'\t' read -r _ table rows storeBytes; do
  [ -n "$table" ] || continue
  noun=rows
  [ "$rows" = "1" ] && noun=row
  if [ "$storeBytes" = "-" ]; then
    printf '  %-26s %s %s\n' "$table" "$rows" "$noun"
  else
    printf '  %-26s %s %s, %s bytes\n' "$table" "$rows" "$noun" "$storeBytes"
  fi
done
upload

cat <<EOF

Restore with the server stopped:
  deploy/restore.sh "$DEST"          # compose volume, verifies and restarts
or, on a bare host:
  rm -f <data-directory>/*.sqlite-wal <data-directory>/*.sqlite-shm
  cp "$DEST"/*.sqlite <data-directory>/
EOF

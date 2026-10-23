#!/usr/bin/env bash
# Snapshot the three Suite SQLite databases into one timestamped directory.
#
# The server keeps running: each database is copied through SQLite's own
# `.backup` command, which takes a read lock and writes a consistent single
# file (including whatever is still in the write-ahead log).
#
# The share database holds the share rows and the draft baselines
# (`share_baselines`); the document database holds the workspace snapshots and
# the projected share documents (`share-*` rooms). All of it is captured.
#
# Usage:
#   deploy/backup.sh [destination-directory]
#
# Environment:
#   SUITE_DATA_DIR        directory holding the default database paths
#                         (default: apps/collab-server)
#   SUITE_DB              document database (default: $SUITE_DATA_DIR/suite.documents.sqlite)
#   SUITE_SHARES_DB       share database    (default: $SUITE_DATA_DIR/suite.shares.sqlite)
#   SUITE_WORKSPACES_DB   owner database    (default: $SUITE_DATA_DIR/suite.workspaces.sqlite)
#
# Restore with the server stopped; see docs/operations.md.
set -euo pipefail

usage() {
  sed -n '2,24p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
macOS: brew install sqlite) or stop the server and copy the three database
files together, including their -wal/-shm sidecars:

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

DOCUMENTS_DB=${SUITE_DB:-"$DATA_DIR/suite.documents.sqlite"}
SHARES_DB=${SUITE_SHARES_DB:-"$DATA_DIR/suite.shares.sqlite"}
WORKSPACES_DB=${SUITE_WORKSPACES_DB:-"$DATA_DIR/suite.workspaces.sqlite"}

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

snapshot() {
  local name=$1 source=$2
  if [ ! -f "$source" ]; then
    printf 'warning: %s does not exist; recorded as missing\n' "$source" >&2
    printf '%s\t%s\tmissing\t0\t-\n' "$name" "$source" >>"$MANIFEST"
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

{
  printf 'created_at\t%s\n' "$STAMP"
  printf 'host\t%s\n' "$(hostname 2>/dev/null || printf 'unknown')"
  printf 'sqlite\t%s\n' "$(sqlite3 --version | cut -d' ' -f1)"
  printf 'file\tname\tsource\tbytes\tsha256\n'
} >"$MANIFEST"

snapshot documents "$DOCUMENTS_DB"
snapshot shares "$SHARES_DB"
snapshot workspaces "$WORKSPACES_DB"

{
  printf '\ncounts\ttable\trows\n'
  if [ -f "$DEST/documents.sqlite" ]; then
    printf 'counts\tdocuments\t%s\n' "$(count_in "$DEST/documents.sqlite" documents)"
    printf 'counts\tshare_projection_documents\t%s\n' \
      "$(sqlite3 "$DEST/documents.sqlite" \
        "SELECT COUNT(*) FROM documents WHERE name LIKE '%:share-%';" 2>/dev/null || printf '0')"
  fi
  if [ -f "$DEST/shares.sqlite" ]; then
    printf 'counts\tshares\t%s\n' "$(count_in "$DEST/shares.sqlite" shares)"
    printf 'counts\tshare_baselines\t%s\n' "$(count_in "$DEST/shares.sqlite" share_baselines)"
  fi
  if [ -f "$DEST/workspaces.sqlite" ]; then
    printf 'counts\tworkspaces\t%s\n' "$(count_in "$DEST/workspaces.sqlite" workspaces)"
  fi
} >>"$MANIFEST"

printf 'snapshot written to %s\n' "$DEST"
sed -n '/^counts/,$p' "$MANIFEST" | tail -n +2 | while IFS=$'\t' read -r _ table rows; do
  printf '  %-26s %s rows\n' "$table" "$rows"
done
cat <<EOF

Restore with the server stopped:
  cp "$DEST"/*.sqlite <data-directory>/
  rm -f <data-directory>/*.sqlite-wal <data-directory>/*.sqlite-shm
EOF

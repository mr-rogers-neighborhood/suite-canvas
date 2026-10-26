#!/usr/bin/env bash
# Gate A1 drill: attachment bytes survive a container recreate, a backup and a
# restore into a scratch volume.
#
# What it proves, in order:
#   1. two attachments, with different byte lengths, uploaded into the composed
#      `app` service are readable byte-for-byte and at the same length after
#      `docker compose up -d --force-recreate app`; a workspace document seeded
#      into the document store still opens through the admin API;
#   2. deploy/backup.sh captures all six stores and records an attachment row
#      count, payload byte total and an id-set checksum in manifest.txt;
#   3. deploy/restore.sh verifies that snapshot and copies it into a *scratch*
#      volume, and an app started on that volume serves the same ids, lengths
#      and bytes, and opens the same workspace.
#
# Nothing touches the `suite` compose project, its volumes or its containers:
# every step runs under its own project name (`suite-drill` by default).
#
# Usage:
#   deploy/drills/attachments.sh [--skip-build] [--keep] [--record <file>]
#
#   --skip-build   reuse the image already built for this checkout
#   --keep         leave the drill containers, volumes and snapshot in place
#   --record FILE  write a markdown drill record to FILE
#
# Exit codes: 0 the drill passed; 1 a step failed; 3 Docker is unavailable.
#
# Environment:
#   SUITE_DRILL_PROJECT   compose project for the live half (default: suite-drill)
#   SUITE_DRILL_DIR       host scratch directory for the snapshot and the copied
#                         volume (default: <repo>/.scratch/drills/attachments-<stamp>,
#                         which is git-ignored). Point it at durable storage when
#                         the run is meant to be kept.
#   SUITE_IMAGE           image compose starts; set it to pin a baseline build
#                         when the checkout's own build cannot start.
set -euo pipefail

usage() {
  sed -n '2,/^set -euo/{/^set -euo/d;p}' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

SKIP_BUILD=0
KEEP=0
RECORD=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -h | --help)
      usage
      exit 0
      ;;
    --skip-build)
      SKIP_BUILD=1
      ;;
    --keep)
      KEEP=1
      ;;
    --record)
      shift
      RECORD=${1:-}
      ;;
    *)
      printf 'error: unknown argument %s (accepted: --skip-build, --keep, --record FILE, --help)\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$ROOT_DIR"

step() { printf '\n== %s\n' "$*"; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

if ! command -v docker >/dev/null 2>&1; then
  cat >&2 <<'EOF'
error: this drill needs Docker (the compose stack is what gate A1 is about).

Without a Docker daemon the deployment half of A1 cannot be executed. The rest
of A1 still holds without it:

  pnpm vitest run --project=server apps/collab-server/src/attachmentDurability.test.ts
      proves the store reopens the same file and returns identical bytes, and
      that compose.yaml points all six stores at /data.

  deploy/backup.sh
  deploy/restore.sh <snapshot> --verify-only
      proves the manifest, per-table row counts, attachment id checksum and
      every integrity_check, without a container.

Record the limitation in deploy/drills/attachments-record.md instead of a
transcript.
EOF
  exit 3
fi

if ! docker info >/dev/null 2>&1; then
  printf 'error: docker is installed but the daemon is not reachable.\n' >&2
  exit 3
fi

PROJECT=${SUITE_DRILL_PROJECT:-suite-drill}
RESTORE_PROJECT="$PROJECT-restore"
# A drill-only credential: the admin API answers 404 without one, and opening a
# workspace after a restore is the point. It is not a secret and never leaves
# the drill's own compose projects.
ADMIN_TOKEN=${SUITE_DRILL_ADMIN_TOKEN:-drill-admin-token-0123456789abcdef}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DRILL_DIR=${SUITE_DRILL_DIR:-"$ROOT_DIR/.scratch/drills/attachments-$STAMP"}
DATA_DIR="$DRILL_DIR/volume"
BACKUPS="$DRILL_DIR/backups"
mkdir -p "$DATA_DIR" "$BACKUPS"

LIVE_COMPOSE=(docker compose -p "$PROJECT" -f "$ROOT_DIR/compose.yaml")
RESTORE_COMPOSE=(docker compose -p "$RESTORE_PROJECT" -f "$ROOT_DIR/compose.yaml")

cleanup() {
  if [ "$KEEP" = "1" ]; then
    printf '\nkept: project %s, project %s, artifacts in %s\n' "$PROJECT" "$RESTORE_PROJECT" "$DRILL_DIR"
    return 0
  fi
  "${LIVE_COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  "${RESTORE_COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  docker volume rm "${RESTORE_PROJECT}_suite-data" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------- helpers

# The client script is a file, not a `node -e` string: the snippet contains
# `${...}` template expressions, and passing it through the shell would expand
# them before the container ever saw it.
CLIENT_JS="$DRILL_DIR/attachment-client.js"

write_client() {
  cat >"$CLIENT_JS" <<'JS'
const { createHash } = require("node:crypto");

const base = "http://127.0.0.1:1235";
const mode = process.env.DRILL_MODE;
const workspaceId = process.env.DRILL_WORKSPACE;
const ownerKey = process.env.DRILL_OWNER;
const mime = "image/png";

// One id per attachment, each with its own deterministic byte length. Two ids
// with different lengths is the point: a store that serves the *wrong* row
// still produces *a* hash, but not the same length for the same id.
const specs = (process.env.DRILL_ATTACHMENTS || "")
  .split(",")
  .filter(Boolean)
  .map((entry) => {
    const [id, size] = entry.split(":");
    return { id, size: Number(size) };
  });

function bytes(size, seed) {
  const out = Buffer.alloc(size);
  for (let i = 0; i < out.length; i += 1) out[i] = (i * 31 + seed) % 251;
  return out;
}

async function main() {
  if (mode === "write") {
    const claim = await fetch(`${base}/api/workspaces/${workspaceId}/claim`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ ownerKey }),
    });
    if (!claim.ok) throw new Error(`claim failed: ${claim.status} ${await claim.text()}`);
    for (const [index, spec] of specs.entries()) {
      const upload = await fetch(`${base}/api/attachments/${workspaceId}`, {
        method: "POST",
        headers: {
          "content-type": mime,
          authorization: `Bearer ${ownerKey}`,
          "x-suite-attachment-id": spec.id,
          origin: base,
        },
        body: bytes(spec.size, 7 + index * 13),
      });
      if (!upload.ok) throw new Error(`upload failed: ${upload.status} ${await upload.text()}`);
    }
  }

  // `ATT <id> <bytes> <sha256>` per id, sorted, so the drill compares the whole
  // set rather than one lucky row.
  const lines = [];
  for (const spec of [...specs].sort((left, right) => left.id.localeCompare(right.id))) {
    const read = await fetch(`${base}/api/attachments/${spec.id}`);
    if (!read.ok) throw new Error(`read ${spec.id} failed: ${read.status} ${await read.text()}`);
    const body = Buffer.from(await read.arrayBuffer());
    const type = read.headers.get("content-type");
    if (type !== mime) throw new Error(`read back ${type}, expected ${mime}`);
    if (body.length !== spec.size) {
      throw new Error(`read back ${body.length} bytes for ${spec.id}, expected ${spec.size}`);
    }
    lines.push(`ATT ${spec.id} ${body.length} ${createHash("sha256").update(body).digest("hex")}`);
  }
  for (const line of lines) console.log(line);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
JS
}

# Runs the client inside the drill app — the API ports are not published, and
# this is the same loopback path the real app uses.
run_client() {
  local project=$1 mode=$2
  docker compose -p "$project" -f "$ROOT_DIR/compose.yaml" exec -T \
    -e "DRILL_MODE=$mode" \
    -e "DRILL_WORKSPACE=$WORKSPACE" \
    -e "DRILL_OWNER=$OWNER" \
    -e "DRILL_ATTACHMENTS=$ATTACHMENTS" \
    app node <"$CLIENT_JS"
}

# `id bytes sha256` per attachment, one per line: the evidential shape for
# "every attachment id resolves with the same byte length".
read_manifest() {
  local project=$1
  run_client "$project" read | sed -n 's/^ATT //p'
}

# ---------------------------------------------------------------- document client

# A workspace is opened, not just stored: the admin API's detail row imports the
# snapshot and counts what it holds. The seed writes one board and one card
# straight into the document store, which is what a save from a room leaves
# behind; the read asks the running app to load it again.
DOCUMENT_JS="$DRILL_DIR/document-client.mjs"

write_document_client() {
  cat >"$DOCUMENT_JS" <<'JS'
const { DatabaseSync } = require("node:sqlite");

const mode = process.env.DRILL_MODE;
const workspaceId = process.env.DRILL_WORKSPACE;

async function main() {
  if (mode === "seed") {
    const { WorkspaceDocument } = await import("/app/packages/graph/dist/index.js");
    const workspace = new WorkspaceDocument();
    workspace.ensureDefaultTypes();
    const board = workspace.ensureBoard();
    workspace.renameBoard(board.id, "Drill board");
    workspace.createCard({ boardId: board.id, position: { x: 0, y: 0 } });
    const snapshot = workspace.doc.export({ mode: "snapshot" });
    const db = new DatabaseSync("/data/documents.sqlite");
    try {
      db.exec("PRAGMA busy_timeout = 5000");
      db.prepare(
        "INSERT OR REPLACE INTO documents (name, state, updated_at) VALUES (?, ?, ?)",
      ).run(`%LOR:${workspaceId}`, snapshot, Date.now());
    } finally {
      db.close();
    }
    console.log(
      `SEEDED bytes=${snapshot.length} boards=${workspace.listBoards().length} cards=${workspace.listCards().length}`,
    );
    return;
  }

  const response = await fetch(`http://127.0.0.1:1235/api/admin/workspaces/${workspaceId}`, {
    headers: { authorization: `Bearer ${process.env.DRILL_ADMIN_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`admin read failed: ${response.status} ${await response.text()}`);
  }
  const row = await response.json();
  console.log(`WORKSPACE boards=${row.boards} cards=${row.cards} bytes=${row.documentBytes}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
JS
}

run_document_client() {
  local project=$1 mode=$2
  docker compose -p "$project" -f "$ROOT_DIR/compose.yaml" exec -T \
    -e "DRILL_MODE=$mode" \
    -e "DRILL_WORKSPACE=$WORKSPACE" \
    -e "DRILL_ADMIN_TOKEN=$ADMIN_TOKEN" \
    app node <"$DOCUMENT_JS"
}

health_wait() {
  local project=$1
  for _ in $(seq 1 60); do
    if docker compose -p "$project" -f "$ROOT_DIR/compose.yaml" exec -T app \
      node -e "fetch('http://127.0.0.1:1235/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  return 1
}

# ------------------------------------------------------------------- 1. live app

step "building and starting the drill app (project $PROJECT)"
if [ "$SKIP_BUILD" = "0" ]; then
  "${LIVE_COMPOSE[@]}" build app
fi
# The admin API is what re-opens a document; without a token it answers 404 and
# this drill would be unable to tell "stored" from "loadable".
export SUITE_ADMIN_TOKEN="$ADMIN_TOKEN"
"${LIVE_COMPOSE[@]}" up -d app

step "waiting for /health"
health_wait "$PROJECT" || die "the drill app never answered /health; inspect: docker compose -p $PROJECT logs app"

WORKSPACE="drill-$STAMP"
OWNER="drill-owner-key-0123456789abcdef"
# Two ids with different byte lengths. The same id must resolve to the same
# length *and* the same bytes after a recreate and after a restore; one id could
# be served from a stale row and still look correct.
ATTACHMENT_ONE=$(printf '%032x' "$(( $(date -u +%s) % 4294967296 ))")
ATTACHMENT_TWO=$(printf '%032x' "$(( ($(date -u +%s) + 7919) % 4294967296 ))")
ATTACHMENTS="$ATTACHMENT_ONE:24576,$ATTACHMENT_TWO:7168"
write_client
write_document_client

step "uploading attachments $ATTACHMENT_ONE and $ATTACHMENT_TWO to workspace $WORKSPACE"
run_client "$PROJECT" write >/dev/null
BEFORE=$(read_manifest "$PROJECT")
printf 'attachments before recreate:\n%s\n' "$BEFORE"

step "seeding and opening a workspace document"
run_document_client "$PROJECT" seed
DOC_BEFORE=$(run_document_client "$PROJECT" read)
printf 'workspace before recreate   %s\n' "$DOC_BEFORE"
case "$DOC_BEFORE" in
  *"boards=1 cards=1"*) ;;
  *) die "the seeded workspace did not open ($DOC_BEFORE)" ;;
esac

step "recreating the container (docker compose up -d --force-recreate app)"
"${LIVE_COMPOSE[@]}" up -d --force-recreate --no-deps app
health_wait "$PROJECT" || die "the recreated app never answered /health"

AFTER=$(read_manifest "$PROJECT")
printf 'attachments after recreate:\n%s\n' "$AFTER"
[ "$BEFORE" = "$AFTER" ] ||
  die "the bytes or lengths changed across a container recreate"

DOC_AFTER=$(run_document_client "$PROJECT" read)
printf 'workspace after recreate    %s\n' "$DOC_AFTER"
[ "$DOC_AFTER" = "$DOC_BEFORE" ] ||
  die "the workspace no longer opens the same way ($DOC_BEFORE -> $DOC_AFTER)"

step "checking the store is on the volume, not in the container"
container=$("${LIVE_COMPOSE[@]}" ps -q app | head -n1)
mount_path=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Name}}{{end}}{{end}}' "$container")
[ -n "$mount_path" ] || die "the app container has no /data volume mount"
printf 'volume                  %s\n' "$mount_path"
docker run --rm -v "$mount_path":/data:ro alpine:3 sh -c 'ls -l /data'

# --------------------------------------------------------------------- 2. backup

step "copying the volume out and running deploy/backup.sh"
# Copied as the caller, not as root: a bind mount filled with root-owned files
# cannot be cleaned up (or restored) by the operator who ran the drill.
docker run --rm --user "$(id -u):$(id -g)" \
  -v "$mount_path":/data:ro -v "$DATA_DIR":/out alpine:3 \
  sh -c 'cp -R /data/. /out/ && chmod -R u+w /out'
SUITE_DATA_DIR="$DATA_DIR" deploy/backup.sh "$BACKUPS"
SNAP=$(find "$BACKUPS" -maxdepth 1 -mindepth 1 -type d -name 'suite-*' | sort | tail -n1)
[ -n "$SNAP" ] || die "backup.sh wrote no snapshot under $BACKUPS"

step "manifest: attachment row count, bytes and id-set checksum"
grep -E '^counts	attachments	' "$SNAP/manifest.txt" || die "the manifest has no attachment row count"
grep -E '^attachment_ids	sha256	' "$SNAP/manifest.txt" || die "the manifest has no attachment id checksum"
grep -E '^file	attachments	' "$SNAP/manifest.txt" || die "the manifest has no attachments file entry"

# -------------------------------------------------------------------- 3. restore

step "verifying the snapshot (deploy/restore.sh --verify-only)"
deploy/restore.sh "$SNAP" --verify-only

step "restoring into the scratch volume ${RESTORE_PROJECT}_suite-data"
docker volume create "${RESTORE_PROJECT}_suite-data" >/dev/null
COMPOSE_PROJECT_NAME=$RESTORE_PROJECT \
  SUITE_DATA_VOLUME="${RESTORE_PROJECT}_suite-data" \
  deploy/restore.sh "$SNAP" --force

step "reading the same attachments back from the restored volume"
health_wait "$RESTORE_PROJECT" || die "the restored app never answered /health"
RESTORED=$(read_manifest "$RESTORE_PROJECT")
printf 'attachments after restore:\n%s\n' "$RESTORED"
[ "$BEFORE" = "$RESTORED" ] || die "the restored bytes or lengths differ"

step "opening the restored workspace"
DOC_RESTORED=$(run_document_client "$RESTORE_PROJECT" read)
printf 'workspace after restore     %s\n' "$DOC_RESTORED"
[ "$DOC_RESTORED" = "$DOC_BEFORE" ] ||
  die "the restored workspace does not open ($DOC_BEFORE -> $DOC_RESTORED)"

step "workspace and attachment rows survived the restore"
docker run --rm -v "${RESTORE_PROJECT}_suite-data":/data:ro alpine:3 sh -c "
  apk add --no-cache sqlite >/dev/null 2>&1
  sqlite3 /data/documents.sqlite \"SELECT COUNT(*) || ' document row(s)' FROM documents;\"
  sqlite3 /data/workspaces.sqlite \"SELECT COUNT(*) || ' workspace claim(s)' FROM workspaces;\"
  sqlite3 /data/attachments.sqlite \"SELECT COUNT(*) || ' attachment row(s), ' || COALESCE(SUM(size), 0) || ' bytes' FROM attachments;\""


cat <<EOF

DRILL PASSED
  attachments before recreate
$(printf '%s\n' "$BEFORE" | sed 's/^/    /')
  identical after recreate and after restore
  workspace $DOC_BEFORE (same after recreate and after restore)
  snapshot          $SNAP
  manifest          $SNAP/manifest.txt
  artifacts         $DRILL_DIR
EOF

if [ -n "$RECORD" ]; then
  {
    printf '# Attachments drill — %s\n\n' "$STAMP"
    printf -- '- Result: **passed**\n'
    printf -- '- Host: `%s`, Docker %s\n' "$(uname -srm)" "$(docker version --format '{{.Server.Version}}')"
    printf -- '- Project: `%s`, restore project: `%s`\n' "$PROJECT" "$RESTORE_PROJECT"
    printf -- '- Volume: `%s`\n' "$mount_path"
    printf -- '- Workspace: `%s`\n\n' "$WORKSPACE"
    printf '`id bytes sha256` per attachment, read back through the deployed API:\n\n```\n'
    printf 'before recreate      after recreate       after restore\n'
    paste -d'|' <(printf '%s\n' "$BEFORE") <(printf '%s\n' "$AFTER") <(printf '%s\n' "$RESTORED") |
      sed 's/|/  |  /g'
    printf '```\n\n'
    printf 'The workspace document, opened by the restored app through `/api/admin/workspaces/<id>`:\n\n'
    printf '| Step | Observed |\n| --- | --- |\n'
    printf '| Seeded into the document store, opened | `%s` |\n' "$DOC_BEFORE"
    printf '| After `up -d --force-recreate app` | `%s` |\n' "$DOC_AFTER"
    printf '| After backup and restore | `%s` |\n\n' "$DOC_RESTORED"
    printf 'Manifest excerpt (host paths replaced with `<drill-dir>`):\n\n```\n'
    grep -E '^(counts|attachment_ids|file)' "$SNAP/manifest.txt" |
      sed -e "s#$SNAP/##" -e "s#$DRILL_DIR#<drill-dir>#g"
    printf '```\n'
    cat <<'NOTES'

Notes and limitations:

- The drill seeds one document row straight into the document store (one board,
  one card) and then asks the running app to open it through
  `/api/admin/workspaces/<id>`, which imports the snapshot and counts what it
  holds. That proves the restored bytes load, not that a browser can join a room:
  the socket join from a real canvas is still a manual step on a real
  deployment.
- `licences` is `missing` on a self-host that never claimed one: the file is
  created on the first claim, so there is nothing to snapshot yet. A restore
  warns and leaves that store alone instead of inventing an empty database.
- "Open the workspace" here means the restored `app` starts on the scratch
  volume, answers `/health`, and serves the same attachment bytes through its
  own API. A browser opening the canvas is a manual step on a real deployment.
NOTES
  } >"$RECORD"
  printf 'record written to %s\n' "$RECORD"
fi

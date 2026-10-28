#!/usr/bin/env bash
# Build Suite on this host from the checkout and restart `app` on the new image.
#
# There is no published image, so there is no registry to go back to: the only
# rollback that exists is a tag taken before the new build replaces the image
# that is running. This script takes that tag first, so a failed upgrade is one
# `docker compose up -d --no-build app` away from the previous build.
#
# The restart is the only interruption. Caddy keeps accepting connections and
# answers 502 while `app` recreates, because it runs its own image.
#
# Usage:
#   deploy/deploy.sh                    back up, tag the running image, build, restart, verify
#   deploy/deploy.sh --no-backup        the same, without the pre-deploy snapshot
#   deploy/deploy.sh --prune            drop the builder cache and the pnpm store first
#   deploy/deploy.sh --rollback TAG     point `app` at a tag that already exists; no build
#   deploy/deploy.sh --list             the suite images this host can run or roll back to
#   deploy/deploy.sh --allow-dirty      build a checkout with uncommitted changes
#
# Environment:
#   SUITE_COMPOSE_FILE      compose file, or several joined by `:` (default: compose.yaml
#                           at the repo root). A host that logs to CloudWatch passes
#                           `compose.yaml:deploy/compose.aws.yaml`, and compose merges them
#                           the way `docker compose -f a -f b` does.
#   SUITE_BACKUP_ENV        env file read by deploy/backup.sh (default: /etc/suite/backup.env)
#   SUITE_BACKUP_DIR        snapshot destination (default: /srv/backups)
#
# The tag built here is the git tag at HEAD, or `v<package.json version>` when
# HEAD is not tagged. It goes into the image as SUITE_VERSION, which is what
# /metrics and /api/admin/status report, so the running container names its
# release without `docker inspect`.
#
# Exit status: 0 when the new container is healthy, 1 otherwise, and a failed
# upgrade prints the rollback command instead of repeating the instructions.
set -euo pipefail

die() { printf 'deploy: %s\n' "$*" >&2; exit 1; }
say() { printf '==> %s\n' "$*"; }

usage() {
  sed -n '2,/^set -euo/{/^set -euo/!s/^# \{0,1\}//p;}' "$0"
}

backup=1
prune=0
list=0
allow_dirty=0
rollback=""

while [ $# -gt 0 ]; do
  case "$1" in
    --no-backup) backup=0 ;;
    --prune) prune=1 ;;
    --list) list=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    --rollback)
      [ $# -ge 2 ] || die "--rollback needs an image tag, for example suite:rollback-v1.1.0"
      rollback=$2
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"

# No `-f` by default, so compose applies its own resolution and a host that sets
# `COMPOSE_FILE` in `.env` (an overlay for CloudWatch logs, say) keeps it here too.
compose_args=()
if [ -n "${SUITE_COMPOSE_FILE:-}" ]; then
  IFS=: read -r -a listed <<<"$SUITE_COMPOSE_FILE"
  for file in "${listed[@]}"; do
    [ -f "$file" ] || die "no $file in $root"
    compose_args+=(-f "$file")
  done
  unset listed
fi
command -v docker >/dev/null 2>&1 || die "docker is not installed"
compose() { docker compose "${compose_args[@]}" "$@"; }

app_container() { compose ps -q app 2>/dev/null | head -n1; }

# The version the running container was built with, or nothing on a host whose
# image predates the build argument.
running_version() {
  local container=$1
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null |
    sed -n 's/^SUITE_VERSION=//p' | head -n1
}

# Wait for the compose healthcheck rather than for the port: the healthcheck
# walks /health, which is what the rest of the guide checks too.
wait_healthy() {
  local limit=45 i=0 container status
  while [ "$i" -lt "$limit" ]; do
    container=$(app_container || true)
    if [ -n "$container" ]; then
      status=$(docker inspect \
        --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
        "$container" 2>/dev/null || true)
      case "$status" in
        healthy) return 0 ;;
        exited | dead) return 1 ;;
      esac
    fi
    i=$((i + 1))
    sleep 2
  done
  return 1
}

# The running tag lives in `.env` so that a reboot, a `docker compose up` and an
# operator reading the file all agree on what is supposed to be running.
pin_image() {
  local image=$1
  [ -f .env ] || die "no .env in $root; copy .env.example to .env and set SUITE_DOMAIN first"
  if grep -qE '^#?[[:space:]]*SUITE_IMAGE=' .env; then
    sed -i -E "s|^#?[[:space:]]*SUITE_IMAGE=.*|SUITE_IMAGE=$image|" .env
  else
    printf '\nSUITE_IMAGE=%s\n' "$image" >>.env
  fi
  say "pinned SUITE_IMAGE=$image in .env"
}

# Restart `app` alone. `--no-build` is deliberate: the image already exists, and
# without it compose may rebuild and retag over the tag being started.
restart_app() {
  local image=$1
  docker image inspect "$image" >/dev/null 2>&1 ||
    die "$image is not on this host; --list shows what is"
  SUITE_IMAGE=$image compose up -d --no-build app
}

if [ "$list" = 1 ]; then
  docker image ls --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}\t{{.Size}}' |
    grep -E '^suite:' || die "no local suite images; nothing has been built on this host yet"
  exit 0
fi

if [ -n "$rollback" ]; then
  docker image inspect "$rollback" >/dev/null 2>&1 ||
    die "$rollback is not on this host; --list shows the tags available"
  pin_image "$rollback"
  say "restarting app on $rollback"
  restart_app "$rollback"
  wait_healthy || die "app did not turn healthy on $rollback; check docker compose logs app"
  say "rolled back to $rollback"
  exit 0
fi

tag=$(git describe --tags --exact-match 2>/dev/null || true)
if [ -z "$tag" ]; then
  # The host that runs this builds in Docker and has no Node — the user-data installs
  # Docker, sqlite3 and the AWS CLI, nothing else — so `node -p` is not available and a
  # deployment would stop here for want of a version string. Ask Node when it exists and
  # read the one field with sed when it does not.
  version=$(node -p "require('./package.json').version" 2>/dev/null || true)
  if [ -z "$version" ]; then
    version=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' package.json | head -n1)
  fi
  [ -n "$version" ] || die "HEAD is not a tag and package.json has no version; check out a release tag"
  tag="v$version"
  printf 'deploy: HEAD is not a tag; building %s from package.json\n' "$tag" >&2
fi

# The tag is the release's identity, so a modified working tree would ship
# something the tag does not name. Untracked files count: the Docker context
# copies them.
if [ "$allow_dirty" = 0 ] && [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  die "the checkout has changes that are not in $tag; commit them or pass --allow-dirty"
fi

if [ "$backup" = 1 ]; then
  backup_env=${SUITE_BACKUP_ENV:-/etc/suite/backup.env}
  backup_dir=${SUITE_BACKUP_DIR:-/srv/backups}
  [ -f "$backup_env" ] ||
    die "no $backup_env for the pre-deploy snapshot; pass --no-backup to skip it deliberately"
  say "snapshotting the six stores into $backup_dir"
  sudo bash -c 'set -a; . "$1"; set +a; exec "$2" "$3"' _ \
    "$backup_env" "$root/deploy/backup.sh" "$backup_dir"
fi

# Tag the image the container is using, before the new build overwrites
# `suite:local` and before compose is pointed anywhere else.
rollback_tag=""
container=$(app_container || true)
if [ -n "$container" ]; then
  current_image=$(docker inspect --format '{{.Image}}' "$container")
  current_version=$(running_version "$container" || true)
  case "$current_version" in
    "" | 0.0.0) current_version=$(date -u +%Y%m%dT%H%M%SZ) ;;
  esac
  rollback_tag="suite:rollback-$current_version"
  if docker image inspect "$rollback_tag" >/dev/null 2>&1; then
    printf 'deploy: %s already exists and is left as it is; a rollback returns to that image, not to the one running now\n' \
      "$rollback_tag" >&2
  else
    docker tag "$current_image" "$rollback_tag"
    say "tagged the running image as $rollback_tag"
  fi
else
  printf 'deploy: app is not running; this is the first build on this host, so there is no image to keep\n' >&2
fi

if [ "$prune" = 1 ]; then
  say "dropping the builder cache"
  docker builder prune -f
  if command -v pnpm >/dev/null 2>&1; then
    say "dropping pnpm store entries no lockfile names"
    pnpm store prune
  fi
fi

say "building suite:$tag"
docker build --target runtime --build-arg "SUITE_VERSION=$tag" \
  -t "suite:$tag" -t suite:local .

pin_image "suite:$tag"
say "restarting app on suite:$tag"
restart_app "suite:$tag"

if wait_healthy; then
  say "app is healthy on suite:$tag"
  if [ -n "$rollback_tag" ]; then
    say "rollback is deploy/deploy.sh --rollback $rollback_tag"
  fi
  exit 0
fi

printf 'deploy: app did not turn healthy on suite:%s\n' "$tag" >&2
printf 'deploy: docker compose logs app\n' >&2
if [ -n "$rollback_tag" ]; then
  printf 'deploy: roll back with deploy/deploy.sh --rollback %s\n' "$rollback_tag" >&2
else
  printf 'deploy: there was no previous image on this host to roll back to\n' >&2
fi
exit 1

#!/usr/bin/env bash
set -euo pipefail

# Install on the VPS as /opt/saadstudio/bin/deploy-release (owner root:root, mode 0755).
# It is executed as root through ONE narrowly scoped sudoers rule for the deploy user
# (see deploy/saaddeploy-sudoers.example) so that `saaddeploy` itself never gets a root
# shell or Docker group membership. It accepts only two allowlisted arguments and never
# evaluates shell supplied by the caller.
ACTION="${1:-}"; REF="${2:-}"
[[ "$ACTION" == "deploy" || "$ACTION" == "rollback" ]] || { echo "invalid action" >&2; exit 2; }
[[ "$REF" =~ ^[A-Za-z0-9._/-]{1,120}$ && "$REF" != -* && "$REF" != *..* ]] || { echo "invalid ref" >&2; exit 2; }

ROOT=/opt/saadstudio
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
REPO="$ROOT/repository"
IMAGE=saad-studio:local
KEEP_RELEASES=5
mkdir -p "$RELEASES"

# One deployment at a time (GitHub concurrency also serialises, this protects manual runs).
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo "another deployment is running" >&2; exit 3; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
git_repo() { git -c safe.directory="$REPO" -C "$REPO" "$@"; }

[[ -f "$ROOT/.env.production" ]] || { echo "missing $ROOT/.env.production" >&2; exit 4; }
command -v docker >/dev/null || { echo "docker not available" >&2; exit 4; }

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then PREVIOUS="$(readlink -f "$CURRENT")"; fi

# Resolve the ref from what was JUST fetched (FETCH_HEAD). `git rev-parse "$REF"` would
# return a stale local branch and silently deploy an old commit.
git_repo fetch --tags origin "$REF"
SHA="$(git_repo rev-parse 'FETCH_HEAD^{commit}')"
TARGET="$RELEASES/$SHA"
if [[ ! -d "$TARGET" ]]; then git_repo worktree add --detach "$TARGET" "$SHA"; fi
ln -sfn "$ROOT/.env.production" "$TARGET/.env.production"

compose_for() { docker compose -p saadstudio -f "$1/docker-compose.yml" -f "$1/docker-compose.serve.yml" "${@:2}"; }

# The compose file uses a fixed image tag, so building overwrites the previous image.
# Keep the running image under a rollback tag BEFORE building so a failed health check can really restore it.
PREV_IMAGE_ID="$(docker image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
if [[ -n "$PREV_IMAGE_ID" ]]; then docker tag "$PREV_IMAGE_ID" saad-studio:rollback-previous; fi

log "building $SHA ($ACTION)"
compose_for "$TARGET" build app

restore_previous() {
  echo "health check failed; restoring previous release" >&2
  if [[ -n "$PREV_IMAGE_ID" ]]; then
    docker tag saad-studio:rollback-previous "$IMAGE"
    local compose_dir="$TARGET"; [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]] && compose_dir="$PREVIOUS"
    compose_for "$compose_dir" up -d --no-deps --force-recreate app || echo "RESTORE FAILED: manual intervention required" >&2
  else
    echo "no previous image to restore; manual intervention required" >&2
  fi
}

if ! compose_for "$TARGET" up -d --no-deps app; then echo "app start failed" >&2; restore_previous; exit 1; fi
healthy=0
for i in {1..30}; do if curl -fsS --max-time 5 http://127.0.0.1:3000/api/health >/dev/null; then healthy=1; break; fi; sleep 2; done
if [[ "$healthy" != 1 ]]; then restore_previous; exit 1; fi

ln -sfn "$TARGET" "$CURRENT"
docker tag "$IMAGE" "saad-studio:release-${SHA:0:12}"
log "deployed $SHA ($ACTION) previous=${PREVIOUS:-none}"

# Prune old release worktrees (never the current, the previous or the target).
mapfile -t OLD < <(ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/$::' | tail -n +$((KEEP_RELEASES + 1)))
for dir in "${OLD[@]:-}"; do
  [[ -n "$dir" && "$dir" != "$TARGET" && "$dir" != "$PREVIOUS" && "$dir" != "$(readlink -f "$CURRENT")" ]] || continue
  git_repo worktree remove --force "$dir" >/dev/null 2>&1 || true
done

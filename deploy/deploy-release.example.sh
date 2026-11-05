#!/usr/bin/env bash
set -euo pipefail

# Install on the VPS as /opt/saadstudio/bin/deploy-release (owner root:root, mode 0755).
# It is executed as root through ONE narrowly scoped sudoers rule for the deploy user
# (see deploy/saaddeploy-sudoers.example) so that `saaddeploy` itself never gets a root
# shell or Docker group membership. It accepts only two allowlisted arguments and never
# evaluates shell supplied by the caller.
if [[ $# -eq 1 && "$1" == preflight ]]; then
  ACTION=preflight; REF=""            # read-only readiness probe: builds, fetches and changes nothing
else
  [[ $# -eq 2 ]] || { echo "usage: deploy-release <deploy|rollback> <ref> | preflight" >&2; exit 2; }
  ACTION="$1"; REF="$2"
  [[ "$ACTION" == "deploy" || "$ACTION" == "rollback" ]] || { echo "invalid action" >&2; exit 2; }
  [[ "$REF" =~ ^[A-Za-z0-9._/-]{1,120}$ && "$REF" != -* && "$REF" != *..* ]] || { echo "invalid ref" >&2; exit 2; }
fi

ROOT=/opt/saadstudio
# Releases are built from a ROOT-OWNED checkout and stored in a ROOT-OWNED directory, so the
# unprivileged deploy user can never plant git hooks/config or swap build contexts that this
# script then executes as root. Override with the environment only from a root shell.
LIVE="${LIVE_DIR:-/opt/saad-studio}"               # existing production checkout + .env.production
RELEASES="${RELEASES_DIR:-$ROOT/root-releases}"
CURRENT="$ROOT/current"
REPO="${REPO_DIR:-$LIVE}"
IMAGE=saad-studio:local
KEEP_RELEASES=5

# One deployment at a time (GitHub concurrency also serialises, this protects manual runs).
exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo "another deployment is running" >&2; exit 3; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
# Hardened git: no hooks, no fsmonitor, no ssh command from repo config, no safe.directory override.
git_repo() { git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c protocol.ext.allow=never -C "$REPO" "$@"; }
# Everything root will execute or build from must be root-owned and not group/world-writable
# (whole tree for .git and releases; top directories and their parents too).
assert_trusted() {
  local p bad
  for p in "$@"; do
    bad="$(find "$p" '(' ! -user root -o -perm /022 ')' -print -quit 2>/dev/null || echo unreadable)"
    [[ -z "$bad" ]] || { echo "untrusted ownership/permissions: $bad" >&2; exit 4; }
  done
}
assert_dir_chain() {
  local d="$1"
  while [[ "$d" != "/" ]]; do
    [[ "$(stat -c '%U' "$d")" == root && -z "$(find "$d" -maxdepth 0 -perm /022)" ]] || { echo "untrusted directory: $d" >&2; exit 4; }
    d="$(dirname "$d")"
  done
}

ENV_FILE="${ENV_FILE:-$LIVE/.env.production}"
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE" >&2; exit 4; }
assert_dir_chain "$REPO"; assert_dir_chain "$RELEASES"
assert_trusted "$REPO/.git" "$RELEASES"
command -v docker >/dev/null || { echo "docker not available" >&2; exit 4; }

if [[ "$ACTION" == preflight ]]; then
  # Evidence, not file existence: every line below comes from actually running the check as root.
  fail=0; say() { printf '%s\n' "$*"; }
  say "env_file=ok"; say "tree_trusted=ok"      # both asserted above (script exits 4 otherwise)
  if docker info >/dev/null 2>&1; then say "docker=ok"; else say "docker=FAIL"; fail=1; fi
  P="$(docker ps --filter publish=3000 --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | head -1)"
  C="$(docker ps --filter publish=3000 --format '{{.Names}}' 2>/dev/null | head -1)"
  if [[ "$P" == saad-studio && "$C" == saad-studio-app-1 ]]; then say "container=ok($C)"; else say "container=FAIL(project=${P:-none} name=${C:-none})"; fail=1; fi
  free_gb="$(df --output=avail -BG / | tail -1 | tr -dc 0-9)"
  if [[ "${free_gb:-0}" -ge 10 ]]; then say "disk_free_gb=${free_gb}"; else say "disk_free_gb=${free_gb:-0} FAIL(<10)"; fail=1; fi
  say "swap_mb=$(free -m | awk '/^Swap:/{print $2}')"
  if git_repo ls-remote --heads origin >/dev/null 2>&1; then say "git_remote=ok"; else say "git_remote=FAIL"; fail=1; fi
  newest="$(ls -1t "$ROOT"/backups/saad-studio-local-*.tar.gz 2>/dev/null | head -1 || true)"
  if [[ -z "$newest" ]]; then bk=missing
  elif pigz -t "$newest" 2>/dev/null && [[ -f "${newest%.tar.gz}.sha256" ]] && sha256sum -c --status "${newest%.tar.gz}.sha256" 2>/dev/null; then bk=verified
  else bk=corrupt; fi
  say "image_backup=$bk"
  if docker image inspect saad-studio:rollback-previous >/dev/null 2>&1; then say "rollback_image=present"; else say "rollback_image=absent"; fi
  if [[ "$fail" -eq 0 && "$bk" == verified ]]; then say "ROLLBACK_READY=yes"; else say "ROLLBACK_READY=no"; fi
  if [[ "$fail" -eq 0 ]]; then say "PREFLIGHT_OK"; exit 0; else say "PREFLIGHT_FAIL"; exit 6; fi
fi

PREVIOUS=""
if [[ -L "$CURRENT" ]]; then PREVIOUS="$(readlink -f "$CURRENT")"; fi

# Resolve the ref from what was JUST fetched (FETCH_HEAD). `git rev-parse "$REF"` would
# return a stale local branch and silently deploy an old commit.
git_repo fetch --tags origin "$REF"
SHA="$(git_repo rev-parse 'FETCH_HEAD^{commit}')"
TARGET="$RELEASES/$SHA"
if [[ ! -d "$TARGET" ]]; then git_repo worktree add --detach "$TARGET" "$SHA"; fi
ln -sfn "$ENV_FILE" "$TARGET/.env.production"
[[ -f "$LIVE/.env" ]] && ln -sfn "$LIVE/.env" "$TARGET/.env"   # SITE_DOMAIN / ACME_EMAIL interpolation

# Reuse the running stack's compose project so we update it instead of creating a second stack.
PROJECT="${COMPOSE_PROJECT:-$(docker ps --filter publish=3000 --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | head -1)}"
PROJECT="${PROJECT:-saad-studio}"
compose_for() { docker compose -p "$PROJECT" -f "$1/docker-compose.yml" -f "$1/docker-compose.serve.yml" "${@:2}"; }

# Scope guard: only the live app container of the live project may be touched.
EXPECTED_PROJECT=saad-studio
EXPECTED_CONTAINER=saad-studio-app-1
[[ "$PROJECT" == "$EXPECTED_PROJECT" ]] || { echo "refusing: compose project is '$PROJECT', expected $EXPECTED_PROJECT" >&2; exit 5; }
RUNNING="$(docker ps --filter publish=3000 --format '{{.Names}}' | head -1)"
[[ "$RUNNING" == "$EXPECTED_CONTAINER" ]] || { echo "refusing: container on :3000 is '${RUNNING:-none}', expected $EXPECTED_CONTAINER" >&2; exit 5; }
app_container_up() { [[ -n "$(docker ps --filter "name=^${EXPECTED_CONTAINER}$" --filter status=running -q)" ]]; }

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
if [[ "$healthy" == 1 ]] && ! app_container_up; then echo "expected container $EXPECTED_CONTAINER is not running" >&2; healthy=0; fi
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

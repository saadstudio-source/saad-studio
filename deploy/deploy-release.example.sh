#!/usr/bin/env bash
set -euo pipefail

# Install on the VPS as /opt/saadstudio/bin/deploy-release, owned by root and
# callable only by the GitHub deploy user. It accepts only two allowlisted
# arguments; it never evaluates shell from the admin UI.
ACTION="${1:-}"; REF="${2:-}"
[[ "$ACTION" == "deploy" || "$ACTION" == "rollback" ]] || { echo "invalid action" >&2; exit 2; }
[[ "$REF" =~ ^[A-Za-z0-9._/-]{1,120}$ && "$REF" != -* && "$REF" != *..* ]] || { echo "invalid ref" >&2; exit 2; }

ROOT=/opt/saadstudio
RELEASES="$ROOT/releases"
CURRENT="$ROOT/current"
mkdir -p "$RELEASES"
cd "$ROOT/repository"
PREVIOUS=""
if [[ -L "$CURRENT" ]]; then PREVIOUS="$(readlink -f "$CURRENT")"; fi
git fetch --tags origin "$REF"
SHA="$(git rev-parse "$REF^{commit}")"
TARGET="$RELEASES/$SHA"
if [[ ! -d "$TARGET" ]]; then git worktree add --detach "$TARGET" "$SHA"; fi
ln -sfn "$ROOT/.env.production" "$TARGET/.env.production"
COMPOSE=(docker compose -p saadstudio -f "$TARGET/docker-compose.yml" -f "$TARGET/docker-compose.serve.yml")
"${COMPOSE[@]}" build app
if ! "${COMPOSE[@]}" up -d --no-deps app; then echo "app start failed" >&2; exit 1; fi
healthy=0
for i in {1..30}; do if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then healthy=1; break; fi; sleep 2; done
if [[ "$healthy" != 1 ]]; then
  echo "health check failed; restoring previous release" >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    docker compose -p saadstudio -f "$PREVIOUS/docker-compose.yml" -f "$PREVIOUS/docker-compose.serve.yml" up -d --no-deps app
  fi
  exit 1
fi
ln -sfn "$TARGET" "$CURRENT"
echo "deployed $SHA ($ACTION)"

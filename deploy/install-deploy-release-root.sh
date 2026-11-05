#!/usr/bin/env bash
# Installs the audited deploy-release script + the sudoers rule for saaddeploy, tests them, and
# RESTORES the previous versions automatically if anything fails.
#
# Run as root, from a ROOT-OWNED directory, after verifying BOTH files there (see the one-liner in
# deploy/INSTALL-DEPLOY-RELEASE.md). The script to install must also live in that root-owned directory
# (STAGED=...). Nothing here deploys, rolls back, restarts or modifies a container/service, and it
# never touches Caddy, the database, Lara or Firecrawl: it only writes the files listed in $OWNED.
set -Eeuo pipefail
umask 077

EXPECTED_SHA="${EXPECTED_SHA:?set EXPECTED_SHA to the SHA-256 of the script to install}"
[[ "$EXPECTED_SHA" =~ ^[0-9a-f]{64}$ ]] || { echo "EXPECTED_SHA must be 64 hex chars" >&2; exit 1; }
STAGED="${STAGED:?set STAGED to the root-owned copy of the script}"
STRICT_PREFLIGHT="${STRICT_PREFLIGHT:-0}"   # 1 = a failing preflight also restores the previous install
BIN="${BIN_PATH:-/opt/saadstudio/bin/deploy-release}"
SUDOERS="${SUDOERS_PATH:-/etc/sudoers.d/saaddeploy}"
B="${BACKUP_DIR:-/opt/saadstudio/backups}"
TS="$(date +%Y%m%d-%H%M%S)"
OLD_BIN="$B/deploy-release.old-$TS"
OLD_SUDOERS="$B/sudoers-saaddeploy.old-$TS"
LOG="${LOG_FILE:-/root/deploy-release-install-$TS.log}"
RULES="$BIN deploy *, $BIN rollback *, $BIN preflight"
had_bin=0; had_sudoers=0; changed=0; finished=0; WORK=""

exec > >(tee -a "$LOG") 2>&1
say() { printf '%s\n' "$*"; }
die() { say "FAIL: $*" >&2; exit 1; }
[[ "${SKIP_ROOT_CHECK:-0}" == 1 || $EUID -eq 0 ]] || die "must run as root"

# Only these two paths (plus our own temp/backup files) are ever written. Restore touches nothing else.
restore() {
  [[ "$changed" -eq 1 ]] || return 0
  say "!! install did not complete -> restoring the previous versions of the 2 owned files"
  if [[ "$had_bin" -eq 1 ]]; then cp -p "$OLD_BIN" "$BIN.restore" && mv -f "$BIN.restore" "$BIN" && say "restored $BIN from $OLD_BIN"; else rm -f "$BIN" && say "removed $BIN (none existed before)"; fi
  if [[ "$had_sudoers" -eq 1 ]]; then cp -p "$OLD_SUDOERS" "$SUDOERS.restore" && mv -f "$SUDOERS.restore" "$SUDOERS" && say "restored $SUDOERS from $OLD_SUDOERS"; else rm -f "$SUDOERS" && say "removed $SUDOERS (none existed before)"; fi
  visudo -c >/dev/null && say "sudoers syntax OK after restore" || say "WARNING: run 'visudo -c' manually"
}
cleanup() { [[ -n "$WORK" ]] && rm -rf "$WORK"; return 0; }
# EXIT trap fires for `die`, failing commands AND signals (INT/TERM/HUP -> exit); restore unless finished cleanly.
trap 'if [[ "$finished" -ne 1 ]]; then restore; fi; cleanup' EXIT
trap 'exit 130' INT TERM HUP

# ---- 0. no dangerous symlinks / writable parents on every path we write or execute from -----------
assert_safe_dir() {            # directory must be root-owned, not group/world-writable, not a symlink, all parents too
  local d="$1"
  [[ -d "$d" && ! -L "$d" ]] || die "$d is missing or a symlink"
  while [[ "$d" != "/" ]]; do
    [[ "$(stat -c '%U' "$d")" == root && -z "$(find "$d" -maxdepth 0 -perm /022)" ]] || die "untrusted directory (not root-owned or group/world-writable): $d"
    d="$(dirname "$d")"
  done
}
assert_not_symlink() { [[ ! -L "$1" ]] || die "$1 is a symlink"; }

# ---- 1. backups directory (create if missing, enforce root:root 0750) -----------------------------
if [[ ! -e "$B" ]]; then install -d -m 0750 -o root -g root "$B"; say "created $B"; fi
assert_not_symlink "$B"; chown root:root "$B"; chmod 0750 "$B"
for d in "$(dirname "$BIN")" "$(dirname "$SUDOERS")" "$B"; do [[ -e "$d" ]] || [[ "$d" == "$(dirname "$BIN")" ]] || die "missing $d"; done
install -d -m 0755 -o root -g root "$(dirname "$BIN")"
assert_safe_dir "$(dirname "$BIN")"; assert_safe_dir "$(dirname "$SUDOERS")"; assert_safe_dir "$B"
for f in "$BIN" "$SUDOERS" "$BIN.new" "$SUDOERS.new" "$BIN.restore" "$SUDOERS.restore"; do assert_not_symlink "$f"; done
say "backups dir: $(stat -c '%U:%G %a' "$B"); target dirs are root-owned and not writable by others"

# ---- 2. review existing grants BEFORE changing anything -------------------------------------------
others="$(grep -rnE '^[^#]*saaddeploy' /etc/sudoers /etc/sudoers.d 2>/dev/null | grep -v "^$SUDOERS:" || true)"
[[ -z "$others" ]] || { say "$others"; die "other sudoers entries grant saaddeploy rights; resolve manually first"; }
if id -nG saaddeploy | tr ' ' '\n' | grep -qxE 'sudo|wheel|admin|docker|root'; then die "saaddeploy is in a privileged group: $(id -nG saaddeploy)"; fi
say "saaddeploy groups: $(id -nG saaddeploy) (no sudo/docker/root group); no other sudoers grants"

# ---- 3. verify the script on the ROOT-OWNED copy, then work only from a private root-owned dir -----
assert_safe_dir "$(dirname "$STAGED")"
[[ -f "$STAGED" && ! -L "$STAGED" && "$(stat -c '%U' "$STAGED")" == root ]] || die "$STAGED must be a regular root-owned file (copy it into a root-owned directory first)"
WORK="$(mktemp -d /root/.dr-install-work.XXXXXX)"; chmod 0700 "$WORK"
cp -- "$STAGED" "$WORK/new-script"                          # single read; everything below uses this private copy
[[ "$(sha256sum "$WORK/new-script" | cut -c1-64)" == "$EXPECTED_SHA" ]] || die "SHA-256 mismatch for $STAGED"
bash -n "$WORK/new-script" || die "bash -n failed"
head -1 "$WORK/new-script" | grep -qx '#!/usr/bin/env bash' || die "unexpected shebang"
say "script verified in private root-owned copy: sha256 OK, bash -n OK"

# ---- 4. state snapshot (proves preflight changes nothing) -----------------------------------------
snap() { docker ps -a --format '{{.ID}} {{.Names}} {{.State}}' | sort | md5sum | cut -c1-32; docker inspect -f '{{.Id}} {{.State.StartedAt}} {{.RestartCount}}' saad-studio-app-1 2>/dev/null || echo "no-app-container"; }
BEFORE="$(snap)"

# ---- 5. back up, then install atomically (temp file in the same dir -> mv) -------------------------
if [[ -e "$BIN" ]]; then cp -p "$BIN" "$OLD_BIN"; had_bin=1; say "backup: $OLD_BIN"; fi
if [[ -e "$SUDOERS" ]]; then cp -p "$SUDOERS" "$OLD_SUDOERS"; had_sudoers=1; say "backup: $OLD_SUDOERS"; fi
changed=1
install -o root -g root -m 0755 "$WORK/new-script" "$BIN.new"
[[ "$(sha256sum "$BIN.new" | cut -c1-64)" == "$EXPECTED_SHA" ]] || die "hash changed after copy"
mv -f "$BIN.new" "$BIN"
printf '%s\n' 'Defaults:saaddeploy env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"' "saaddeploy ALL=(root) NOPASSWD: $RULES" > "$WORK/sudoers.new"
visudo -cf "$WORK/sudoers.new" >/dev/null || die "visudo rejected the new rule"
install -o root -g root -m 0440 "$WORK/sudoers.new" "$SUDOERS.new"   # name contains '.', so sudo ignores it until the mv
mv -f "$SUDOERS.new" "$SUDOERS"

# ---- 6. tests: any failure -> EXIT trap -> automatic restore ---------------------------------------
[[ "$(sha256sum "$BIN" | cut -c1-64)" == "$EXPECTED_SHA" ]] || die "installed hash mismatch"
[[ "$(stat -c '%U:%G %a' "$BIN")" == "root:root 755" ]] || die "bad owner/mode on $BIN"
[[ "$(stat -c '%U:%G %a' "$SUDOERS")" == "root:root 440" ]] || die "bad owner/mode on $SUDOERS"
visudo -c >/dev/null || die "visudo -c failed"
listed="$(sudo -l -U saaddeploy 2>&1)"
say "== sudo -l -U saaddeploy"; say "$listed" | sed -n '/may run/,$p'
if say "$listed" | grep -Eq 'NOPASSWD: *ALL|\) *ALL *$|\(ALL[^)]*\) *ALL'; then die "saaddeploy appears to have unrestricted sudo"; fi
say "$listed" | grep -q "$BIN preflight" || die "preflight rule not active"
say "== layer 1: sudoers must REFUSE anything outside the 3 rules (sudo itself exits 1; the script is never run)"
for args in "bogus x" "preflight extra" "--version" "bash -c id"; do
  set +e; out="$(sudo -u saaddeploy sudo -n "$BIN" $args 2>&1)"; rc=$?; set -e
  say "  [sudo refuses] deploy-release $args -> exit $rc"
  [[ "$rc" -eq 1 ]] || die "sudoers did not refuse '$args' (exit $rc)"
  grep -qiE 'sudo:' <<<"$out" || die "'$args' failed for a reason other than sudo refusing it: $out"
  grep -q 'usage:' <<<"$out" && die "'$args' reached the script; sudoers rule is too wide"
done
say "== layer 2: arguments sudoers lets through must be rejected by the script itself with exit 2 (validation runs before any lock/docker/git; nothing is deployed)"
for args in "deploy a b" "rollback a b" "deploy -x" "deploy a..b" "rollback bad!ref" "deploy ./../x"; do
  set +e; sudo -u saaddeploy sudo -n "$BIN" $args >/dev/null 2>&1; rc=$?; set -e
  say "  [script rejects] deploy-release $args -> exit $rc"; [[ "$rc" -eq 2 ]] || die "script argument validation failed for: $args (exit $rc, expected 2)"
done
# No-argument forms: depending on sudoers wildcard semantics either sudo refuses (1) or the script rejects (2). Both are safe; anything else is not.
for args in "deploy" "rollback"; do
  set +e; sudo -u saaddeploy sudo -n "$BIN" $args >/dev/null 2>&1; rc=$?; set -e
  say "  [either] deploy-release $args -> exit $rc"; [[ "$rc" -eq 1 || "$rc" -eq 2 ]] || die "unexpected result for bare '$args' (exit $rc)"
done
say "== preflight (read-only) as saaddeploy"
set +e; PF="$(sudo -u saaddeploy sudo -n "$BIN" preflight 2>&1)"; prc=$?; set -e
say "$PF"; say "preflight exit=$prc"
[[ "$prc" -eq 0 || "$prc" -eq 6 ]] || die "preflight could not run at all (exit $prc)"
[[ "$prc" -eq 0 || "$STRICT_PREFLIGHT" != 1 ]] || die "preflight reported failures and STRICT_PREFLIGHT=1"
AFTER="$(snap)"
[[ "$BEFORE" == "$AFTER" ]] || die "container state changed during the install/preflight (BEFORE != AFTER)"
say "== container/service state unchanged: YES"

finished=1
say ""
say "INSTALLED (script + sudoers are a complete, tested pair).  log: $LOG"
say "docker      : $(grep -m1 '^docker=' <<<"$PF" || echo '?')"
say "container   : $(grep -m1 '^container=' <<<"$PF" || echo '?')"
say "image_backup: $(grep -m1 '^image_backup=' <<<"$PF" || echo '?')   $(grep -m1 '^ROLLBACK_READY=' <<<"$PF" || true)"
say "Undo: cp -p $OLD_BIN $BIN ; cp -p $OLD_SUDOERS $SUDOERS ; visudo -c"
if [[ "$prc" -ne 0 ]]; then say "NOTE: preflight reported FAIL (a server-state problem, not an install problem). Files stay installed so it can be diagnosed; fix it before any deploy."; exit 3; fi

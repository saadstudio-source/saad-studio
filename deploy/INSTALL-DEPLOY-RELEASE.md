# Installing deploy-release on the VPS (run as root — NOT executed automatically)

Facts verified read-only before writing this:
- Live stack: `/opt/saad-studio` (root-owned git checkout), compose project `saad-studio`, service `app`, container `saad-studio-app-1`, caddy runs as a separate container. Compose files on the server are byte-identical to the repo's.
- `/opt/saad-studio/.env.production` is a **symlink to `.env`**, which is `600 root:root` (3946 bytes). It is already locked down: **do not chmod anything** (the "777" shown by `stat` is just the symlink's own mode).
- `origin` is the public GitHub repo (anonymous fetch works); `.git` is root-owned and not group/world-writable.
- The script touches ONLY container `saad-studio-app-1` (`up -d --no-deps app`); it refuses to run (exit 5) if the compose project is not `saad-studio` or the container on :3000 is not `saad-studio-app-1`. Caddy, the database, Lara and Firecrawl are never touched.
- Rollback: before building, the running image is tagged `saad-studio:rollback-previous`; on a failed start/health check (or if the container is not running) that image is re-tagged `saad-studio:local` and the container is recreated. Successful releases are also tagged `saad-studio:release-<sha12>`.

## 0. Read-only preflight (changes nothing)
```bash
docker compose ls | grep -w saad-studio
docker ps --filter publish=3000 --format '{{.Names}}'          # must print: saad-studio-app-1
find /opt/saad-studio/.git '(' ! -user root -o -perm /022 ')' -print -quit   # must print nothing
stat -L -c '%a %U:%G' /opt/saad-studio/.env                     # expect: 600 root:root
git -c safe.directory=/opt/saad-studio -C /opt/saad-studio ls-remote --heads origin migration/contabo
```

## 1. Create two empty root-only directories (no effect on the running site)
```bash
install -d -m 0755 -o root -g root /opt/saadstudio/root-releases
install -d -m 0750 -o root -g root /opt/saadstudio/backups
```

## 2. Install the script (hash must match; installing does not run it)
The staged copy is already in `/home/saaddeploy/deploy-release.staged`.
```bash
echo '<SHA256>  /home/saaddeploy/deploy-release.staged' | sha256sum -c -
bash -n /home/saaddeploy/deploy-release.staged
install -o root -g root -m 0755 /home/saaddeploy/deploy-release.staged /opt/saadstudio/bin/deploy-release
```

## 3. sudoers — validate in a temp file before activating
```bash
printf '%s\n' \
  'Defaults:saaddeploy env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"' \
  'saaddeploy ALL=(root) NOPASSWD: /opt/saadstudio/bin/deploy-release deploy *, /opt/saadstudio/bin/deploy-release rollback *' \
  > /etc/sudoers.d/saaddeploy.new
chmod 0440 /etc/sudoers.d/saaddeploy.new
visudo -cf /etc/sudoers.d/saaddeploy.new && mv /etc/sudoers.d/saaddeploy.new /etc/sudoers.d/saaddeploy
```

## 4. Smoke test that deploys nothing
```bash
sudo -n -l -U saaddeploy                                              # only the two deploy-release rules
sudo -u saaddeploy sudo -n /opt/saadstudio/bin/deploy-release bogus x; echo "exit=$?"   # expect 2
sudo -u saaddeploy sudo -n /opt/saadstudio/bin/deploy-release deploy; echo "exit=$?"    # expect 2 (needs 2 args)
```

## Undo
```bash
rm -f /etc/sudoers.d/saaddeploy /opt/saadstudio/bin/deploy-release
```

## Notes
- `fetch` / `worktree add` write refs and worktree metadata into `/opt/saad-studio/.git`. Set `REPO_DIR` to a dedicated root-owned clone if you want the live checkout untouched.
- Do not run it at the same time as the manual (PM2) deployment.
- The GitHub workflow runs: validate → deploy-manager-tests + site tests (verify) + integration → deploy. A deploy is only started from Deploy Manager / workflow_dispatch; installing the script does not start one.

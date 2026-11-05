# Installing deploy-release on the VPS (run as root — NOT executed automatically)

Verified read-only facts this runbook relies on: live stack = `/opt/saad-studio` (compose project `saad-studio`,
default from directory name; service `app`; `docker-compose.yml` and `docker-compose.serve.yml` are byte-identical to the repo's),
`origin` is the public `https://github.com/seedsat1/saad-studio.git` (no credentials needed), `.git` is root-owned and not group/world-writable.

## 0. Preflight (read-only)
```bash
docker compose ls                                   # expect project "saad-studio"
docker ps --filter publish=3000 --format '{{.Label "com.docker.compose.project"}} {{.Names}}'
find /opt/saad-studio/.git '(' ! -user root -o -perm /022 ')' -print -quit   # must print nothing
git -c safe.directory=/opt/saad-studio -C /opt/saad-studio ls-remote --heads origin migration/contabo
stat -c '%a %U' /opt/saad-studio/.env.production    # currently 777: see step 1
```

## 1. Directories and env-file permissions
```bash
chmod 600 /opt/saad-studio/.env.production          # root-run compose still reads it; container gets values via env_file
install -d -m 0755 -o root -g root /opt/saadstudio/bin /opt/saadstudio/root-releases
install -d -m 0750 -o root -g root /opt/saadstudio/backups
```

## 2. Install the script (verify the hash first)
```bash
echo '<SHA256-OF-CURRENT-deploy-release.example.sh>  /home/saaddeploy/deploy-release.staged' | sha256sum -c -
bash -n /home/saaddeploy/deploy-release.staged
install -o root -g root -m 0755 /home/saaddeploy/deploy-release.staged /opt/saadstudio/bin/deploy-release
```

## 3. sudoers (validate before activating)
```bash
printf '%s\n' \
  'Defaults:saaddeploy env_reset, secure_path="/usr/sbin:/usr/bin:/sbin:/bin"' \
  'saaddeploy ALL=(root) NOPASSWD: /opt/saadstudio/bin/deploy-release deploy *, /opt/saadstudio/bin/deploy-release rollback *' \
  > /etc/sudoers.d/saaddeploy.new
chmod 0440 /etc/sudoers.d/saaddeploy.new
visudo -cf /etc/sudoers.d/saaddeploy.new && mv /etc/sudoers.d/saaddeploy.new /etc/sudoers.d/saaddeploy
```

## 4. Smoke test WITHOUT deploying
```bash
sudo -n -l -U saaddeploy                              # shows only the two deploy-release rules
sudo -u saaddeploy sudo -n /opt/saadstudio/bin/deploy-release bogus x; echo $?   # expect 2 (invalid action)
```

## Notes
- The script only builds/starts service `app`; it never recreates `caddy` or `ffmpeg-scratch` (`--no-deps app`).
- `fetch`/`worktree add` write into `/opt/saad-studio/.git` (refs, worktree metadata). Set `REPO_DIR` to a dedicated root-owned clone if you want the live checkout untouched.
- Coordinate with the manual (PM2) deployment so both are not run at the same time.

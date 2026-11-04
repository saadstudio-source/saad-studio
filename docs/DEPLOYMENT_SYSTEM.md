# SaadStudio deployment system

## Current state

The repository already contains a Docker/Compose runtime and Caddy TLS layer:

- `Dockerfile` builds Next.js standalone output and includes ffmpeg and Prisma.
- `docker-compose.yml` runs the app on loopback port 3000 with `/api/health` as a container health check.
- `docker-compose.serve.yml` adds Caddy on ports 80/443 and keeps Neon, Supabase, Clerk, B2/R2, Stripe, and model providers external.

The new control plane is additive. It does not change the site UI or provider integrations.

## Automated flow

`.github/workflows/deploy.yml` is manually dispatchable from GitHub or through the protected admin API. It:

1. Checks out the requested branch or commit reference.
2. Installs dependencies, runs TypeScript, Vitest, the production build, and a separate isolated Postgres integration job.
3. Uses a GitHub Actions production environment and SSH secrets to call one fixed VPS script.
4. Uses a concurrency group so two production deployments cannot run simultaneously.

No shell text from the admin UI is forwarded. The API accepts only `deploy` or `rollback` and a constrained branch/SHA ref. GitHub Actions remains the source of the deployment logs.

## Admin control plane

- UI: `/admin/deployments`
- API: `/api/admin/deployments`
- Both are protected by the existing `isAdmin()` guard. In local development, the existing localhost admin behavior applies; production requires `ADMIN_USER_ID` and a Clerk session.
- `GET` reads the last GitHub Actions runs.
- `POST { action: "deploy" | "rollback", ref: "main" | "<commit SHA>" }` dispatches the fixed workflow through the GitHub API.
- The backend needs `GITHUB_DEPLOY_TOKEN`, `GITHUB_DEPLOY_OWNER`, `GITHUB_DEPLOY_REPO`, and optionally `GITHUB_DEPLOY_WORKFLOW`. These are runtime secrets and must never be committed.

## VPS release model

Install `deploy/deploy-release.example.sh` on the VPS as `/opt/saadstudio/bin/deploy-release`, owned by root and callable by the dedicated GitHub deploy user. It creates immutable git worktrees under `/opt/saadstudio/releases/<commit>`, keeps `/opt/saadstudio/current`, builds the requested image, starts the fixed Compose project, and checks `/api/health` before switching `current`.

If health fails, it attempts to restore the previous release. It does not run Prisma migrations, `git reset --hard`, arbitrary commands, or provider generation. Keep `.env.production` outside Git at `/opt/saadstudio/.env.production` with mode 600.

## Required one-time setup (not executed here)

1. Confirm VPS access, Ubuntu/Docker/Compose resources, and free disk/CPU/RAM.
2. Confirm `A`/`AAAA` DNS for `saadstudio.app` and `www` points to the VPS, with ports 80/443 reachable. Do not change DNS until the current service has a rollback path.
3. Create GitHub Actions secrets: `CONTABO_HOST`, `CONTABO_USER`, `CONTABO_SSH_KEY`, `CONTABO_SSH_FINGERPRINT`.
4. Create the GitHub environment `production` and require an environment reviewer for the first deployments.
5. Configure repository runtime secrets on the VPS only: Clerk, Neon/Supabase, B2/R2, Stripe, WaveSpeed/KIE, `CRON_SECRET`, `ADMIN_USER_ID`, `SITE_DOMAIN`, and `ACME_EMAIL`.
6. Install the fixed release script and validate it with a dry-run/health-only procedure before the first public switch.
7. Back up Caddy's `caddy-data` volume and keep the existing Vercel/PM2 route available until DNS and health checks are verified.

## Safety rules

- No API keys or passwords are stored in GitHub source, workflow logs, Docker images, or the admin UI.
- No automatic destructive database migration is part of deployment. Prisma client generation is allowed; schema changes require a separately approved migration procedure.
- CI integration uses a disposable Postgres service on port 5433 and `prisma db push`; it is never a production database and is not run by the VPS deployment script.
- GitHub Actions `concurrency` is the deployment lock. The VPS script uses a fixed Compose project name.
- Rollback is a known commit SHA, not arbitrary shell or a free-form path.
- The current Compose/Caddy configuration is preserved; Lara and Firecrawl are not managed or stopped by this system.

## Local verification performed

- Existing Docker Compose/Caddy files and health endpoint were inspected.
- Existing deployment script was not reused because it performs `git reset --hard` and PM2 restart without release isolation or rollback.
- New workflow/API/UI files are local-only until GitHub secrets, the production environment, VPS script, DNS, and an explicit first-deployment approval exist.

## Remaining status

**Local preparation:** implemented.  **Production readiness:** BLOCKED pending VPS/DNS/secret/resource verification and a human-approved first deployment. No production service was contacted or stopped by this change.

## Windows Deploy Manager — 2026-11-04

- Added `deploy-manager/`, a small Electron desktop app using the existing Electron runtime under `saad-agent`.
- Deploy/Rollback dispatch the existing `.github/workflows/deploy.yml` through GitHub API; they do not create a second deployment path and were not invoked during testing.
- Server Status calls the public `/api/health?full=1` endpoint. Optional SSH verification uses `ssh2`, an explicitly entered user/key, and an exact stored `SHA256:` host fingerprint; unknown fingerprints are rejected.
- GitHub token and SSH private key are stored with Windows Credential Manager via `keytar`; the JSON settings file contains only non-secret metadata.
- A local desktop shortcut `SaadStudio Deploy Manager.lnk` was created. It launches `deploy-manager/Start.ps1` and performs no deployment by itself.
- Shortcut fix: the first shortcut used the Arabic project path directly and Windows stored the argument path incorrectly. It now launches through the ASCII helper junction `C:\Users\PC\SaadStudioDeployManager`, which points to the project without changing project files.
- Local checks: JavaScript syntax checks passed; `keytar` and `ssh2` loaded successfully; the app window stayed open in two clean shortcut launches; Credential Manager round-trip passed with a temporary value that was deleted. No GitHub dispatch, SSH login, paid provider call, production DB action, Lara change, or Firecrawl action was performed.
- First-run approval remains required for entering the GitHub token, SSH key, and verified server fingerprint. The app will not accept an unknown fingerprint automatically.

## Production readiness check — 2026-11-04

- GitHub repository: **verified read-only**. Remote is `seedsat1/saad-studio`; `origin/main` exists and the current checkout is `migration/contabo`. The deployment workflow is present locally but has not been dispatched.
- DNS: **verified**. `saadstudio.app` and `www.saadstudio.app` resolve to `161.97.77.229`. No DNS records were changed. An IPv6/AAAA answer was not observed in the check.
- Network reachability: TCP port 80 on `161.97.77.229` responded from the checking environment. Ports 22 and 443 were not fully evidenced by the bounded check and must be verified from an ordinary PowerShell session before the first deployment.
- VPS software/resources: **BLOCKED / unverified**. No SSH credentials were available, so Ubuntu, Docker, Node.js, Caddy, disk/RAM/CPU, release directories, and the existing service could not be inspected. No SSH attempt or server change was made.
- GitHub Secrets and production environment: **BLOCKED / unverified**. The local process has no `GITHUB_DEPLOY_TOKEN` or Contabo secret values; secrets cannot be created by this local repository and must be configured in GitHub Settings. No secret values were printed.
- Local health: not running on `127.0.0.1:3000` during the check. The route implementation is present and the container health check is configured, but live production health remains unverified.
- First deployment: **not executed**, as required. The exact next step is to configure the GitHub `production` environment and SSH secrets, then provide/verify VPS access and resource checks before manually dispatching `deploy.yml` with `release_ref=main`.

## Automatic setup controls — 2026-11-04

- Added in-app GitHub OAuth Device Flow. It requires a real registered OAuth App Client ID; the application does not invent one or fall back to a manually entered PAT.
- Added Ed25519 key generation with private-key storage in Windows Credential Manager and a visible public-key result for the approved server setup step.
- Contabo user creation and public-key installation remain **pending by design**: they require a verified SSH session and explicit confirmation. Existing SSH access is not modified and no server command was executed.
- JavaScript checks passed after these changes. No GitHub login, SSH login, deployment, rollback, production DB action, Lara action, or Firecrawl action was performed.

## OAuth and state audit — 2026-11-04

| Finding | Root cause | Fix | Evidence |
|---|---|---|---|
| Deployment history showed raw IPC error when GitHub was not connected | Renderer called `deployments:list` during startup and the main process threw a manual-token error | `githubStatus` and `deployments:list` now return explicit states; renderer skips history until `connected` and shows Arabic guidance | Mocked disconnected path is covered by the state contract; no raw IPC error is rendered |
| OAuth polling handled only pending/success | Response errors were collapsed into a generic `error` field | Added explicit `pending`, `expired`, `denied`, `api_error`, and `connection_error` states, with expiry deadline and slow-down interval | `oauth-flow.test.cjs` covers pending, slow_down, expired, denied, success, and offline cases |
| Connection badge was static | UI inferred connection from token presence only | UI now verifies `/user` and repository access/permissions before showing `متصل` | Code path uses GitHub API verification; no live account test was run |
| Deploy/Rollback could appear enabled before auth verification | Buttons were not tied to verified state | Buttons are disabled unless state is `connected` | Renderer state transition code; no workflow was dispatched |

## Verification status

- JavaScript syntax: **PASS** (`main.cjs`, `preload.cjs`, `renderer.js`).
- OAuth mock contract: **PASS** (`oauth-flow.test.cjs`).
- Credential Manager round-trip: **PASS** previously with a temporary value deleted afterward.
- Real GitHub OAuth/API: **BLOCKED / not run** because no registered OAuth Client ID or user authorization was supplied.
- SSH/VPS: **BLOCKED / not run** because no approved SSH user/key/fingerprint was supplied.
- Deploy/Rollback: **NOT RUN by policy**.

## Contabo setup wizard — 2026-11-04

- Added in-app controls for extracting the SSH host fingerprint, displaying it for independent verification, and provisioning the fixed `saaddeploy` user and `/opt/saadstudio/{bin,repository,releases}` directories after explicit confirmation.
- The bootstrap password is accepted only as an IPC argument for the one setup call, is not written to settings or Credential Manager, and is cleared from the form after success. The existing root password and SSH access are not changed.
- Provisioning reuses the existing Ed25519 public key from Credential Manager; it does not generate or replace a key.
- Local syntax, OAuth mock, and window-launch checks pass. **Real Contabo setup is BLOCKED/not run** because no bootstrap SSH credentials or independently verified fingerprint were supplied. GitHub Actions Secrets setup and production readiness therefore remain pending.

## Persistence and readiness — 2026-11-04

- Non-secret settings persist in the app data settings file; GitHub OAuth and SSH keys remain in Windows Credential Manager. Bootstrap/root passwords are not persisted.
- Startup now restores the saved metadata and checks GitHub identity/repository access, public health, and presence of the saved deployment key/fingerprint before enabling deployment controls.
- GitHub repository secret/environment status can be queried by name only; secret values are never returned. The required names are `CONTABO_HOST`, `CONTABO_USER`, `CONTABO_SSH_KEY`, and `CONTABO_SSH_FINGERPRINT`.
- Real restore, GitHub secret verification, SSH verification, and deploy readiness remain **BLOCKED** until the user completes OAuth and approved Contabo provisioning. No deployment was run.

## Real connection recovery check — 2026-11-04

- Windows Credential Manager: GitHub access token present; Ed25519 private/public key entries present. Values were not printed. Stored non-secret settings still have empty bootstrap user, `contaboUser`, and fingerprint, so SSH was not attempted.
- GitHub API: **PASS read-only** — `/user` returned `seedsat1`; repository access returned 200; `deploy.yml` workflow returned 200; `production` environment returned 200. No workflow dispatch was made.
- GitHub repository secrets: **BLOCKED** — the secrets endpoint returned no secret names. No secret values were read or changed.
- Website: **PASS read-only** — `https://saadstudio.app/api/health?full=1` returned HTTP 200, `ok=true`, `status=healthy`, and database check true.
- Contabo network: TCP/22 reachable. SSH authentication and fingerprint verification: **BLOCKED**, because the saved configuration has no deployment user or confirmed fingerprint. No root password was requested and no SSH command ran.
- Final readiness: **NOT READY**. GitHub and health are connected; Contabo SSH identity and repository secrets still require the user's approved setup path.

## Setup wizard next-step repair — 2026-11-04

- **Root cause confirmed:** the next-button save path reloaded settings and unconditionally switched to the dashboard before the wizard transition could be observed. Wizard field IDs were also not used by the generic save payload, and the current step was not persisted.
- **Fix:** preserve the wizard view during wizard saves, save/restore bounded `wizardStep`, read wizard fields when active, and preserve existing values during partial saves. A valid stored GitHub credential continues through `githubStatus()` without forced reauthorization.
- Added safe GitHub-only external-link IPC plus “open authorization page” and “copy code” controls; the authorization code is rendered LTR.
- **Verification:** syntax checks passed for `main.cjs`, `preload.cjs`, and `renderer.js`; `oauth-flow.test.cjs` passed. No Deploy/Rollback, SSH setup, or paid operation was run.
- Playwright/Electron five-step UI acceptance remains **BLOCKED**, because no local Electron binary/test runner was available here; it is not claimed as PASS.

## SSH fingerprint extraction repair — 2026-11-04

- **Root cause confirmed:** the wizard handler read only `bootstrapPassword` and `user`, while step 3 supplies `wizPassword` and `wizUser`. It returned before invoking IPC, so no SSH attempt or user-visible result occurred.
- **Fix:** step 3 now reads the wizard fields, reports the target and operation state, uses explicit SSH `hostHash: "sha256"`, preserves the observed host fingerprint for verification, and reports timeout/connection errors. The fingerprint confirmation checkbox is reset unchecked on startup.
- Navigation from step 3 is blocked unless a valid `SHA256:` fingerprint exists and independent verification is explicitly checked.
- **Electron UI check:** the real Electron window exposed `wizFingerprintCheck` and the handler was invoked without changing server state. With no bootstrap password supplied, the safe validation path stopped before authentication; no real fingerprint was claimed. TCP probe to `161.97.77.229:22` returned `False` in this environment, so live SSH fingerprint acquisition is **BLOCKED**, not PASS.
- Syntax and OAuth mock checks remain PASS. No Deploy/Rollback, key replacement, or server modification occurred.

## SSH fingerprint format hardening — 2026-11-04

- Confirmed the UI formatter previously returned a 64-character hex digest unchanged. It now converts a 32-byte hex digest to OpenSSH `SHA256:<Base64>` form.
- The host verifier normalizes observed and expected values and uses the SSH host public key supplied by `ssh2` (`hostHash: "sha256"`); the deployment user's private key is not used to calculate the host fingerprint.
- Added a copy-fingerprint button and explicit unchecked confirmation initialization. Navigation remains blocked until a valid OpenSSH fingerprint and independent confirmation exist.
- Syntax and OAuth mock checks passed. Live fingerprint acquisition remains **BLOCKED** without bootstrap credentials; the TCP probe to `161.97.77.229:22` failed. No server/key/deploy action occurred.

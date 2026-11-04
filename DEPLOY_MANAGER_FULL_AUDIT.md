# SaadStudio Deploy Manager — Full Audit

Date: 2026-11-04

## Scope and safety

- Audited `deploy-manager/main.cjs`, `preload.cjs`, `renderer.js`, `index.html`, and OAuth helper/tests.
- No Deploy, Rollback, SSH provisioning, key replacement, production database change, Lara action, or Firecrawl action was performed.
- Secrets, tokens, private keys, passwords, and fingerprints were not printed.
- `systematic-debugging`, `playwright`, and `security-audit` instructions were read. Requested `electron`, `nodejs`, `github-actions`, and `testing` skill files were not installed under the checked skill roots; no names are claimed as used.

## Findings fixed

1. The OAuth helper `pollDeviceToken()` discarded `clientId` and `deviceCode`; it now sends the required form body and headers. The test asserts both fields.
2. `ssh:generate` always created a new Ed25519 key and overwrote Credential Manager. It now derives and returns the public key from the existing private key and only generates when no private key exists.
3. `server:ssh-test` used the bootstrap user field after provisioning. It now uses the configured deployment user (`saaddeploy`) and normalizes the SHA256 host fingerprint before comparison.

## Function audit

| Function | Problem / root cause | Fix | Test/evidence | Result |
|---|---|---|---|---|
| GitHub OAuth Device Flow | Main flow handles pending/slow-down/expiry/denial; helper polling previously omitted required request fields | Fixed helper request contract | `oauth-flow.test.cjs`; syntax check | PASS local contract; live OAuth not re-run |
| OAuth token storage | Token is stored through `keytar`, not project files | No change | Prior Credential Manager presence check, values redacted | PASS evidence; token refresh not supported by GitHub Device Flow |
| Settings persistence | Non-secret metadata is JSON; secrets use Credential Manager | Preserved partial-save values and wizard step | `settings:save` code review; no secret output | PASS static; restart restore not fully automated |
| Credential Manager | Uses `keytar` service/account | No plaintext secret logging found in reviewed paths | Keytar round-trip previously passed | PASS local evidence |
| Ed25519 generation | Existing key was overwritten on repeated setup | Reuse existing private key and re-derive public key | `ssh:generate` code path review; syntax | PASS static; live Credential Manager invocation not repeated |
| Public-key derivation | Uses `crypto.createPublicKey` and SSH wire encoding | No change | `publicEd25519Ssh` review | PASS static |
| Host fingerprint extraction | UI read wrong wizard password/user fields; hex digest could display unchanged | Wizard fields wired; hex converted to `SHA256:<Base64>`; `hostHash=sha256` | Syntax; Electron button was exposed/invoked previously; TCP probe failed | BLOCKED live SSH |
| Independent fingerprint confirmation | Checkbox state could appear selected from UI state | Reset unchecked; step-3 navigation requires valid fingerprint and explicit check | Renderer guard review | PASS static; independent external match not available |
| Contabo SSH | Requires bootstrap credentials and server reachability | No server change | `Test-NetConnection 161.97.77.229 -Port 22` returned `False` in this environment | BLOCKED |
| `saaddeploy` provisioning | Uses a privileged bootstrap SSH command and must not be inferred from local key existence | No execution | No SSH credentials supplied; no command run | BLOCKED |
| Deployment directories/permissions | Must be verified on server, not assumed | No execution | No SSH session | BLOCKED |
| GitHub Secrets | Read-only names/environment check exists; no secret values exposed | No change | Prior API check: endpoint had no secret names | BLOCKED / incomplete configuration |
| GitHub Actions workflow | Workflow/environment read-only checks previously returned 200 | No dispatch | Prior read-only GitHub evidence; no dispatch | PASS read-only; deployment not tested |
| Website health | Uses HTTPS health endpoint with timeout | No change | Prior `saadstudio.app/api/health?full=1` returned HTTP 200 healthy | PASS prior live read-only |
| Readiness | Combines GitHub, key/fingerprint presence, and health; does not prove SSH authentication | Existing behavior retained | Static review | BLOCKED for production readiness |
| Deploy | Backend validates action/ref and serializes operations; readiness gate is not fully enforced in backend | No dispatch allowed by task | No Workflow dispatch | BLOCKED / requires hardening before production |
| Rollback | Uses same dispatch channel and confirmation UI | No rollback run | No rollback run | BLOCKED / untested |
| Deployment log | Lists runs only after verified GitHub status | No change | Renderer/backend review | PASS static; live refresh previously read-only |
| Five-step wizard | Step persistence/view transition repaired in prior task | Preserves wizard view and `wizardStep` | Electron UI showed wizard; Playwright runner unavailable | PARTIAL / Playwright BLOCKED |
| Renderer ↔ preload ↔ main IPC | 90 renderer IDs were checked against HTML; no missing IDs; channels reviewed | Fixed OAuth/key/SSH contracts | Static contract scan: `missing_html=` empty, 15 handlers | PASS static |

## Automated checks

- `node --check deploy-manager/main.cjs`: PASS
- `node --check deploy-manager/preload.cjs`: PASS
- `node --check deploy-manager/renderer.js`: PASS
- `node deploy-manager/oauth-flow.test.cjs`: PASS (`oauth-mock-contract=PASS`)
- Renderer ID/HTML scan: PASS (`90` IDs checked, `missing_html` empty)
- Electron/Playwright full five-step automation: BLOCKED; no dedicated Electron Playwright runner was installed/available. This is not reported as PASS.

## Remaining blockers before production

1. Supply approved bootstrap SSH credentials and an independently trusted Contabo host fingerprint, then perform a real read-only SSH test as `saaddeploy`.
2. Configure and verify the required GitHub production secrets by names, without exposing values.
3. Add a backend readiness check before `deployments:dispatch`; current UI disabling is not sufficient as a server-side control.
4. Run a real Electron test harness for startup/restart, all wizard transitions, and failure states.
5. Perform a supervised live Workflow test only after explicit approval; no such test was run in this audit.

## SSH public-key restoration follow-up — 2026-11-04

- Root cause: settings returned only key presence; startup never derived or populated the public key fields.
- Fix: validate the stored private key, derive the matching Ed25519 public key, populate both UI fields from one settings:get response, and add an explicit restore button. The private key is never returned to renderer or logs.
- Direct Credential Manager validation from this environment returned Access is denied without exposing values. Therefore live persistence/reopen verification is BLOCKED, not PASS.

## Readiness recheck repair — 2026-11-04

- Root cause: the button was wired to runWizardFinalReadinessCheck, but the backend returned configuration presence for SSH and only three terse checks. It did not verify the Workflow, required Secrets, or live SSH authentication, and the renderer had no busy state or detailed result rendering.
- Fix: readiness now performs a fresh GitHub status, Workflow read, required-secret name check, live read-only SSH probe with host-fingerprint verification, and HTTPS health check. The response includes timestamp, state, message, status, and missing-secret names (never values). The button disables during execution, shows an immediate loading label, prevents re-entry, and renders per-check results and duration.
- Local syntax and OAuth contract tests: PASS. Existing Electron process could be inspected, but the current live window was an older loaded UI and the CUA click could not obtain geometry; fresh Electron UI proof of updated results is BLOCKED, not PASS.
- No Deploy/Rollback or server modification occurred.

## Readiness failure visibility follow-up — 2026-11-04

- The supplied screenshot is valid evidence that the UI remained at its default state. The remaining defect was the renderer catch path: IPC errors were written only to the general output log, while the step-5 detail stayed at “لم يُنفذ الفحص بعد”.
- Fixed the catch path to mark every readiness item failed and display the actual error plus timestamp. GitHub Credential Manager access errors are also converted to an explicit connection state instead of an unhandled IPC rejection.
- Syntax and OAuth contract tests pass. A fresh click/result proof in the live Electron window remains BLOCKED because two existing Electron windows are running and CUA reported unavailable geometry for the target window; no PASS is claimed.

## SSH key-format repair — 2026-11-04

- Evidence: the supplied real Electron result reached `deployment:readiness` and failed every SSH-dependent check with `Cannot parse privateKey: Unsupported key format`.
- Root cause: the existing Ed25519 key was stored as Node PKCS#8 PEM, while `ssh2` requires OpenSSH private-key encoding for `privateKey`.
- Fix: added `deploy-manager/ssh-key-format.cjs`; it converts the existing key to OpenSSH `openssh-key-v1` only in memory. No Credential Manager value, SSH key, server, Deploy, or Rollback was changed.
- Verification: generated Ed25519 PKCS#8 key → converted → `ssh2.utils.parseKey` returned `ssh-ed25519`; `node --check` passed for main, renderer, and converter.
- Status: local format conversion PASS. Live Electron readiness after the fix remains BLOCKED until the running app is restarted and the button is clicked; no false PASS is claimed.

## GitHub Environment SSH secret action — 2026-11-04

- Added `إضافة المفتاح إلى GitHub` to the SSH management view with an explicit confirmation dialog.
- The backend reads the private key only from Windows Credential Manager, converts it in memory, encrypts it using the GitHub Environment public key, PUTs `CONTABO_SSH_KEY` to `production`, then verifies its presence by name.
- No secret value is exposed to renderer/logs/files. No upload was executed and no Deploy/Rollback was run.
- Static syntax checks pass. Live GitHub upload remains pending explicit user confirmation and a valid GitHub session.
- Follow-up: fixed the sealed-box implementation to match GitHub's libsodium format and changed failures to show the exact HTTP status plus GitHub's sanitized `message`. This is a code fix; no upload was executed.
- Screenshot evidence showed the target Environment is `Production` (capital P); all environment-secret API paths now use that exact name. Syntax checks pass; live upload remains unexecuted.
- Real Electron error was `Digest method not supported`, proving the failure occurred locally before GitHub API. Added a dependency-free BLAKE2b fallback compatible with older Electron and matched its empty-input digest to Node crypto. Live upload remains unexecuted.
- The next live attempt reached GitHub and returned HTTP 422 for improper encryption. Replaced the custom BLAKE2b call with pure-JS `blakejs`, verified against Node Crypto; no additional upload was attempted after this correction.

## Server diagnostics page — 2026-11-04
| Area | Result | Evidence |
|---|---|---|
| Page/navigation | PASS (local) | Source Electron opened; AX tree exposed `التشخيص الشامل للسيرفر` / `navAudit`. |
| Audit backend/UI wiring | PASS (static) | Syntax checks passed; fixed read-only commands, fingerprint verification, scrubbing, timeouts, cancellation, progressive events. |
| Live Contabo audit | BLOCKED | CUA click failed with `coordinate input geometry is unavailable`; no SSH audit was executed. |
| Production readiness | UNVERIFIED | Live evidence for Docker, Caddy, releases, backups, health/database and workflow mapping is still required. |

No deploy, rollback, restart, server mutation, database change, or SSH-key change was performed.

## SSH audit fingerprint fix — 2026-11-04

- Root cause confirmed: `ssh2` returns a hexadecimal SHA-256 digest under `hostHash: "sha256"`, while the saved fingerprint uses OpenSSH `SHA256:<base64>` format. The audit path compared them without conversion and rejected the host.
- Fixed `deploy-manager/server-audit.cjs` to convert only valid 64-hex digests to OpenSSH base64 before strict comparison. Mismatches and unknown fingerprints remain blocked.
- Status: code fix applied; live Electron retest remains pending. No Deploy/Rollback or server mutation was performed.

## Server repair wizard — 2026-11-04

| Component | Result | Evidence |
|---|---|---|
| Repair page/button | IMPLEMENTED | Added `view-repair`, `navRepair`, and `btnLoadRepairPlan`. |
| Read-only HTTPS discovery | IMPLEMENTED | Fixed SSH command enumerates listeners/services/processes without changing them. |
| Per-change approval | IMPLEMENTED | Write steps render command/impact and require a separate `موافقة وتنفيذ` confirmation. |
| Docker preparation | IMPLEMENTED, NOT APPLIED | Uses explicit `sudo -n usermod -aG docker saaddeploy`; no execution performed. |
| Deploy script installation | IMPLEMENTED, NOT APPLIED | Transfers the reviewed local script to `/tmp`, installs root-owned `0750` at `/opt/saadstudio/bin/deploy-release`; does not run it. |
| Backup directories | IMPLEMENTED, NOT APPLIED | Creates only the two directories with fixed ownership/mode; does not claim a backup. |
| Live repair test | BLOCKED | Electron single-instance behavior left the inspected window on the prior audit view; no repair button was clicked and no server mutation occurred. |

### Repair button follow-up
- The button now invokes the existing verified SSH connection for a read-only HTTPS/process probe, then renders the returned evidence and the approval-gated plan.
- It records start/completion timestamps and duration in the visible activity log, disables itself during the request, and displays IPC/SSH errors.
- No write step is executed by `بدء الإصلاح`; live Electron click verification remains BLOCKED by the current single-instance window limitation.

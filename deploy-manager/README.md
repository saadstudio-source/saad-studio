# SaadStudio Deploy Manager

Windows Electron manager for the existing `.github/workflows/deploy.yml`.

## Local run

From the repository root:

```powershell
& '.\saad-agent\node_modules\.bin\electron.cmd' '.\deploy-manager\main.cjs'
```

The first run opens Settings fields. GitHub token and SSH private key are stored with Windows Credential Manager through `keytar`; `settings.json` contains only non-secret connection metadata. The SSH test requires an explicitly entered `SHA256:` host fingerprint and never accepts an unknown host automatically.

Deploy and Rollback call GitHub Actions dispatch only. They are intentionally not exercised during local testing.

## Windows EXE (portable, free tools only)

```
node build-exe.cjs            # writes dist/SaadStudio-DeployManager-win-x64/SaadStudio Deploy Manager.exe
```

Uses the Electron runtime already installed under `saad-agent/node_modules/electron/dist` (no network, no paid tools).
The build copies only runtime files, refuses to finish if a key/token/settings file slipped in, and never includes secrets:
the SSH key and GitHub token live in Windows Credential Manager, settings in `%APPDATA%\saadstudio-deploy-manager`
(non-secret settings are imported once from the older `%APPDATA%\Electron\settings.json`).
Deploy and Rollback always ask for explicit confirmation; nothing runs on the server until you confirm.

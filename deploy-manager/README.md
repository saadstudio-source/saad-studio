# SaadStudio Deploy Manager

Windows Electron manager for the existing `.github/workflows/deploy.yml`.

## Local run

From the repository root:

```powershell
& '.\saad-agent\node_modules\.bin\electron.cmd' '.\deploy-manager\main.cjs'
```

The first run opens Settings fields. GitHub token and SSH private key are stored with Windows Credential Manager through `keytar`; `settings.json` contains only non-secret connection metadata. The SSH test requires an explicitly entered `SHA256:` host fingerprint and never accepts an unknown host automatically.

Deploy and Rollback call GitHub Actions dispatch only. They are intentionally not exercised during local testing.

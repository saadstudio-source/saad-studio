// Builds a portable Windows folder with "SaadStudio Deploy Manager.exe" using only free, local pieces:
// the Electron runtime already on this machine + this app's runtime files. No network, no paid tools.
// Nothing secret is ever copied: SSH key / GitHub token live in Windows Credential Manager and settings in %APPDATA%.
//
//   node build-exe.cjs [path-to-electron-dist]
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const REPO = path.join(ROOT, "..");
const ELECTRON_DIST = process.argv[2] || path.join(REPO, "saad-agent", "node_modules", "electron", "dist");
const OUT_BASE = path.join(ROOT, "dist");
const OUT = path.join(OUT_BASE, "SaadStudio-DeployManager-win-x64");
const EXE_NAME = "SaadStudio Deploy Manager.exe";

// Allowlist: only what the app needs at runtime (tests, docs and anything else stay out).
const APP_FILES = ["main.cjs", "preload.cjs", "renderer.js", "index.html", "style.css", "direct-deploy.cjs", "github-secret.cjs", "oauth-flow.cjs", "server-audit.cjs", "server-repair.cjs", "ssh-key-format.cjs"];
const SERVER_SCRIPT = path.join("deploy", "deploy-release.example.sh"); // server-repair.cjs reads ../deploy/... relative to the app folder

function copyDir(src, dst, skip = () => false) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (skip(s, e)) continue;
    if (e.isDirectory()) copyDir(s, d, skip); else if (e.isFile()) fs.copyFileSync(s, d);
  }
}

if (!fs.existsSync(path.join(ELECTRON_DIST, "electron.exe"))) throw new Error("electron.exe not found in " + ELECTRON_DIST);
fs.rmSync(OUT, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
if (fs.existsSync(OUT)) throw new Error("could not clean " + OUT + " (close the running exe, delete the folder, retry)");

// 1) Electron runtime (without its debug log and default demo app)
copyDir(ELECTRON_DIST, OUT, (s) => /(^|[\\/])(debug\.log|default_app\.asar)$/.test(s));
fs.renameSync(path.join(OUT, "electron.exe"), path.join(OUT, EXE_NAME));

// 2) app code
const APP = path.join(OUT, "resources", "app");
fs.mkdirSync(APP, { recursive: true });
for (const f of APP_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(APP, f));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
fs.writeFileSync(path.join(APP, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main, description: pkg.description, dependencies: pkg.dependencies }, null, 2));
copyDir(path.join(ROOT, "node_modules"), path.join(APP, "node_modules"), (s) => /[\\/]\.(bin|cache)$/.test(s) || /\.(md|markdown|map)$/i.test(s) || /node_modules[\\/].*[\\/](test|tests|fixtures|examples?)$/.test(s));

// 3) the server script the app hashes/uploads (resources/deploy/…)
fs.mkdirSync(path.join(OUT, "resources", "deploy"), { recursive: true });
fs.copyFileSync(path.join(REPO, SERVER_SCRIPT), path.join(OUT, "resources", SERVER_SCRIPT));

// 4) safety net: refuse to finish if anything that looks like a secret/settings file slipped in
const bad = [];
(function scan(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (/^(settings\.json|deploy-history\.json|\.env.*|id_(rsa|ed25519).*|.*\.pem|.*\.key)$/i.test(e.name)) bad.push(p);
    else if (p.startsWith(APP) && fs.statSync(p).size < 2_000_000 && /\.(cjs|js|json|html|css|sh|md)$/i.test(e.name)) {
      const t = fs.readFileSync(p, "utf8");
      // A real key has a long base64 body right after the header; library constants / UI placeholders do not.
      const privateKeyWithBody = /-----BEGIN [A-Z ]*PRIVATE KEY-----\s*[A-Za-z0-9+\/=]{60,}/;
      if (privateKeyWithBody.test(t) || /gh[pousr]_[A-Za-z0-9]{30,}/.test(t) || /github_pat_[A-Za-z0-9_]{30,}/.test(t)) bad.push(p);
    }
  }
})(OUT);
if (bad.length) { fs.rmSync(OUT, { recursive: true, force: true }); throw new Error("secret-like files found, build removed:\n" + bad.join("\n")); }
console.log("OK " + path.join(OUT, EXE_NAME));

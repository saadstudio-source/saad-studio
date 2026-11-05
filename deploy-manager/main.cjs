const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const keytar = require("keytar");
const { Client } = require("ssh2");
const { classifyDeviceResponse } = require("./oauth-flow.cjs");
const { toOpenSshEd25519 } = require("./ssh-key-format.cjs");
const { runServerAudit } = require("./server-audit.cjs");
const { getRepairPlan, executeRepairStep, probeServerReadiness } = require("./server-repair.cjs");

const SERVICE = "SaadStudio Deploy Manager";
const ACCOUNT = "default";
const GITHUB_ENVIRONMENT = "Production";
// releaseBranch = the branch GitHub dispatches the workflow on. deploy.yml currently exists only on migration/contabo.
const DEFAULTS = { host: "161.97.77.229", domain: "saadstudio.app", user: "", fingerprint: "", owner: "saadstudio-source", repo: "saad-studio", workflow: "deploy.yml", releaseBranch: "migration/contabo" };
const REF_PATTERN = /^[A-Za-z0-9._\/-]{1,120}$/;
const USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
const READINESS_DEADLINE_MS = 70000;
let win;
let operation = false;
const auditSessions = new Map();

// Only one manager instance may run (two instances fight over keytar/settings and the audit lock).
const hasInstanceLock = app.requestSingleInstanceLock();
if (!hasInstanceLock) { app.quit(); }
else { app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } }); }

// fetch with a hard timeout so no GitHub call can leave the UI waiting forever.
function ghFetch(url, options = {}, ms = 10000) { return fetch(url, { ...options, signal: AbortSignal.timeout(ms) }); }
// Resolve with `fallback` if the work does not finish in time (the work's own timers still clean up).
function withDeadline(promise, ms, fallback) { let t; return Promise.race([promise, new Promise((resolve) => { t = setTimeout(() => resolve(fallback), ms); })]).finally(() => clearTimeout(t)); }
// IPC is only accepted from our own local index.html.
function assertTrustedSender(event) { const url = event?.senderFrame?.url || event?.sender?.getURL?.() || ""; if (!url.startsWith("file://") || !/\/index\.html(?:[?#].*)?$/.test(url)) throw new Error("مصدر IPC غير موثوق"); }
const rawIpcHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => rawIpcHandle(channel, (event, ...args) => { assertTrustedSender(event); return listener(event, ...args); });

function settingsPath() { return path.join(app.getPath("userData"), "settings.json"); }
// The repository moved from seedsat1/saad-studio to saadstudio-source/saad-studio: migrate saved settings so the UI/API never use the old owner.
const OLD_OWNER = "seedsat1";
function migrateSettings(s) { return s.owner === OLD_OWNER ? { ...s, owner: DEFAULTS.owner } : s; }
function loadSettings() { try { return migrateSettings({ ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), "utf8")) }); } catch { return { ...DEFAULTS }; } }
function saveSettings(input) {
  const current = loadSettings();
  const requestedDeployUser = String(input.contaboUser || current.contaboUser || "saaddeploy").trim();
  if (!USER_PATTERN.test(requestedDeployUser)) throw new Error("اسم مستخدم النشر غير صالح");
  const requestedBranch = String(input.releaseBranch || current.releaseBranch || DEFAULTS.releaseBranch).trim();
  if (!REF_PATTERN.test(requestedBranch) || requestedBranch.includes("..") || requestedBranch.startsWith("-")) throw new Error("اسم فرع النشر غير صالح");
  const next = { ...current, releaseBranch: requestedBranch, host: String(input.host || current.host).trim(), domain: String(input.domain || current.domain).trim(), user: String(input.user || current.user || "").trim(), fingerprint: String(input.fingerprint || current.fingerprint || "").trim(), contaboUser: requestedDeployUser, owner: String(input.owner || current.owner).trim(), repo: String(input.repo || current.repo).trim(), workflow: String(input.workflow || current.workflow).trim(), githubClientId: String(input.githubClientId || current.githubClientId || "").trim(), wizardStep: Math.max(1, Math.min(5, Number(input.wizardStep || current.wizardStep || 1))) };
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}
async function secret(name, value) { if (value !== undefined) await keytar.setPassword(SERVICE, `${ACCOUNT}:${name}`, value); return keytar.getPassword(SERVICE, `${ACCOUNT}:${name}`); }
function ghHeaders(token) { return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "SaadStudio-Deploy-Manager" }; }
const { encryptGithubSecret } = require("./github-secret.cjs");
// Small dependency-free BLAKE2b fallback: Electron versions without OpenSSL BLAKE2 support still work.
function blake2b(input, outputLength) {
  const MASK = (1n << 64n) - 1n;
  const IV = [0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n, 0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n];
  const SIGMA = [[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3],[11,8,12,0,5,2,15,13,10,14,3,6,7,1,9,4],[7,9,3,1,13,12,11,14,2,6,5,10,4,0,15,8],[9,0,5,7,2,4,10,15,14,1,11,12,6,8,3,13],[2,12,6,10,0,11,8,3,4,13,7,5,15,14,1,9],[12,5,1,15,14,13,4,10,0,7,6,3,9,2,8,11],[13,11,7,14,12,1,3,9,5,0,15,4,8,6,2,10],[6,15,14,9,11,3,0,8,12,2,13,7,1,4,10,5],[10,2,8,4,7,6,1,5,15,11,9,14,3,12,13,0],[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15],[14,10,4,8,9,15,13,6,1,12,0,2,11,7,5,3]];
  const rotr = (x, n) => ((x >> BigInt(n)) | (x << BigInt(64 - n))) & MASK;
  const block = Buffer.alloc(128); Buffer.from(input).copy(block);
  const m = Array.from({ length: 16 }, (_, i) => block.readBigUInt64LE(i * 8));
  const h = IV.slice(); h[0] ^= 0x01010000n ^ BigInt(outputLength);
  const v = h.concat(IV); v[12] ^= BigInt(input.length); v[14] ^= MASK;
  const g = (a,b,c,d,x,y) => { v[a] = (v[a] + v[b] + x) & MASK; v[d] = rotr(v[d] ^ v[a], 32); v[c] = (v[c] + v[d]) & MASK; v[b] = rotr(v[b] ^ v[c], 24); v[a] = (v[a] + v[b] + y) & MASK; v[d] = rotr(v[d] ^ v[a], 16); v[c] = (v[c] + v[d]) & MASK; v[b] = rotr(v[b] ^ v[c], 63); };
  for (let r = 0; r < 12; r++) { const s = SIGMA[r]; g(0,4,8,12,m[s[0]],m[s[1]]); g(1,5,9,13,m[s[2]],m[s[3]]); g(2,6,10,14,m[s[4]],m[s[5]]); g(3,7,11,15,m[s[6]],m[s[7]]); g(0,5,10,15,m[s[8]],m[s[9]]); g(1,6,11,12,m[s[10]],m[s[11]]); g(2,7,8,13,m[s[12]],m[s[13]]); g(3,4,9,14,m[s[14]],m[s[15]]); }
  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) & MASK;
  const out = Buffer.alloc(64); h.forEach((x, i) => out.writeBigUInt64LE(x, i * 8)); return out.subarray(0, outputLength);
}
async function githubResponseError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  const detail = typeof body.message === "string" ? body.message : "";
  return new Error(`${fallback} — HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
}
function apiUrl(s, suffix) { return `https://api.github.com/repos/${encodeURIComponent(s.owner)}/${encodeURIComponent(s.repo)}${suffix}`; }
function githubStateError(state, message) { return { ok: false, state, message }; }
async function githubStatus() {
  const s = loadSettings(); let token; try { token = await secret("github"); } catch { return githubStateError("connection_error", "تعذر الوصول إلى Windows Credential Manager"); }
  if (!token) return githubStateError("disconnected", "يرجى ربط حساب GitHub أولاً");
  try {
    const userResponse = await ghFetch("https://api.github.com/user", { headers: ghHeaders(token) }, 8000);
    if (userResponse.status === 401) return githubStateError("expired", "انتهت جلسة GitHub، أعد الربط");
    if (!userResponse.ok) return githubStateError("api_error", "تعذر التحقق من حساب GitHub");
    const repoResponse = await ghFetch(apiUrl(s, ""), { headers: ghHeaders(token) }, 8000);
    if (repoResponse.status === 401) return githubStateError("expired", "انتهت جلسة GitHub، أعد الربط");
    if (repoResponse.status === 403) return githubStateError("permission_error", "حساب GitHub لا يملك صلاحية قراءة المستودع");
    if (!repoResponse.ok) return githubStateError("api_error", "تعذر الوصول إلى مستودع SaadStudio");
    const repo = await repoResponse.json();
    const canRun = repo.permissions?.push === true || repo.permissions?.admin === true;
    return canRun ? { ok: true, state: "connected", login: (await userResponse.json()).login, permissions: repo.permissions } : githubStateError("permission_error", "الحساب لا يملك صلاحية تشغيل Workflow");
  } catch (e) { return githubStateError("connection_error", e?.name === "TimeoutError" ? "انتهت مهلة الاتصال بـ GitHub (8 ثوانٍ)" : "تعذر الاتصال بـ GitHub"); }
}
function publicEd25519Ssh(privateKey) {
  const publicDer = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const raw = publicDer.subarray(publicDer.length - 32);
  const part = (value) => { const b = Buffer.from(value); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };
  return `ssh-ed25519 ${Buffer.concat([part("ssh-ed25519"), part(raw)]).toString("base64")} saadstudio-deploy`;
}
async function sshPublicState() {
  const privateKey = await secret("ssh");
  if (!privateKey) return { ok: false, state: "missing", message: "لا يوجد مفتاح SSH محفوظ" };
  try {
    const publicKey = publicEd25519Ssh(privateKey);
    await secret("ssh-public", publicKey);
    return { ok: true, state: "valid", publicKey, algorithm: "ed25519" };
  } catch (error) {
    return { ok: false, state: "invalid", message: "المفتاح المحفوظ غير صالح أو ليس Ed25519" };
  }
}
function normalizeOpenSshFingerprint(value) {
  const text = String(value || "").trim();
  if (text.startsWith("SHA256:")) return text;
  if (/^[0-9a-fA-F]{64}$/.test(text)) return `SHA256:${Buffer.from(text, "hex").toString("base64")}`;
  return text;
}
function sshExec({ host, username, password, privateKey, fingerprint, command, captureFingerprint = false }) { return new Promise((resolve, reject) => { const c = new Client(); let observed = ""; let settled = false; const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); }; const timer = setTimeout(() => { c.end(); finish(reject, new Error("انتهت مهلة اتصال SSH خلال 15 ثانية")); }, 15000); c.on("ready", () => { c.exec(command, (err, stream) => { if (err) return finish(reject, err); let out = ""; let error = ""; stream.on("data", (b) => { out += b.toString(); }); stream.stderr.on("data", (b) => { error += b.toString(); }); stream.on("close", (code) => { c.end(); code === 0 ? finish(resolve, { ok: true, output: out }) : finish(reject, new Error(error || `أمر SSH فشل (${code})`)); }); }); }).on("error", (e) => { if (captureFingerprint && observed) finish(resolve, { ok: false, state: "fingerprint_required", fingerprint: observed }); else finish(reject, new Error(`فشل اتصال SSH: ${e.message}`)); }).connect({ host, port: 22, username, password, privateKey, readyTimeout: 10000, hostHash: "sha256", hostVerifier: (hash) => { observed = normalizeOpenSshFingerprint(hash); return Boolean(fingerprint && observed === normalizeOpenSshFingerprint(fingerprint)); } }); }); }

ipcMain.handle("settings:get", async () => { const s = loadSettings(); const ssh = await sshPublicState(); return { ...s, hasGithubToken: Boolean(await secret("github")), hasSshKey: ssh.ok, sshPublicKey: ssh.publicKey || "", sshKeyState: ssh.state, sshKeyMessage: ssh.message || "" }; });
ipcMain.handle("ssh:restore-public", async () => sshPublicState());
ipcMain.handle("settings:save", async (_e, input) => { const s = saveSettings(input || {}); if (input?.githubToken) await secret("github", String(input.githubToken)); if (input?.sshKey) await secret("ssh", String(input.sshKey)); return { ...s, hasGithubToken: Boolean(await secret("github")), hasSshKey: Boolean(await secret("ssh")) }; });
ipcMain.handle("shell:open-external", async (_e, url) => { const value = String(url || ""); if (!/^https:\/\/github\.com\//i.test(value)) throw new Error("لا يمكن فتح هذا الرابط بأمان"); await shell.openExternal(value); return { ok: true }; });
ipcMain.handle("github:status", async () => githubStatus());
ipcMain.handle("github:secrets-status", async () => { const s = loadSettings(); const token = await secret("github"); if (!token) return { ok: false, state: "disconnected", names: [], environment: false }; try { const [a, b] = await Promise.all([ghFetch(apiUrl(s, `/environments/${encodeURIComponent(GITHUB_ENVIRONMENT)}/secrets`), { headers: ghHeaders(token) }, 8000), ghFetch(apiUrl(s, `/environments/${encodeURIComponent(GITHUB_ENVIRONMENT)}`), { headers: ghHeaders(token) }, 8000)]); const d = await a.json().catch(() => ({})); return { ok: a.ok && b.ok, state: a.status === 401 || b.status === 401 ? "expired" : a.ok && b.ok ? "verified" : "missing", names: d.secrets?.map((x) => x.name) || [], environment: b.ok }; } catch { return { ok: false, state: "connection_error", names: [], environment: false }; } });
ipcMain.handle("github:add-ssh-secret", async () => {
  const s = loadSettings(); const token = await secret("github"); const privateKey = await secret("ssh");
  if (!token) throw new Error("يرجى ربط حساب GitHub أولاً");
  if (!privateKey) throw new Error("لا يوجد مفتاح SSH خاص محفوظ");
  const openSshKey = toOpenSshEd25519(privateKey);
  const base = apiUrl(s, `/environments/${encodeURIComponent(GITHUB_ENVIRONMENT)}`);
  const headers = ghHeaders(token);
  const keyResponse = await fetch(base + "/secrets/public-key", { headers, signal: AbortSignal.timeout(8000) });
  const keyData = await keyResponse.json().catch(() => ({}));
  if (!keyResponse.ok) throw await githubResponseError(keyResponse, "تعذر قراءة مفتاح تشفير GitHub لبيئة production");
  if (!keyData.key || !keyData.key_id) throw new Error("استجابة GitHub لم تتضمن key أو key_id لبيئة production");
  const encrypted = encryptGithubSecret(openSshKey, keyData.key);
  const put = await fetch(base + "/secrets/CONTABO_SSH_KEY", { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ encrypted_value: encrypted, key_id: keyData.key_id }), signal: AbortSignal.timeout(8000) });
  if (!put.ok) throw await githubResponseError(put, "فشل حفظ CONTABO_SSH_KEY في GitHub");
  const verify = await fetch(base + "/secrets", { headers, signal: AbortSignal.timeout(8000) });
  const names = (await verify.json().catch(() => ({}))).secrets?.map((item) => item.name) || [];
  if (!verify.ok) throw await githubResponseError(verify, "تم الإرسال لكن فشل التحقق من Secrets الخاصة بالبيئة");
  if (!names.includes("CONTABO_SSH_KEY")) throw new Error("استجاب GitHub بنجاح لكن CONTABO_SSH_KEY لا يظهر ضمن Secrets الخاصة ببيئة production");
  return { ok: true, name: "CONTABO_SSH_KEY", environment: GITHUB_ENVIRONMENT };
});
async function computeReadiness() {
  const checkedAt = new Date().toISOString(); const s = loadSettings(); const github = await githubStatus();
  const workflow = { ok: false, state: "unknown", message: "لم يتم فحص Workflow" };
  const secrets = { ok: false, state: "unknown", missing: [], names: [], message: "لم يتم فحص Secrets" };
  const key = await secret("ssh");
  if (github.ok) {
    const token = await secret("github");
    try { const wr = await fetch(apiUrl(s, "/actions/workflows/" + encodeURIComponent(s.workflow)), { headers: ghHeaders(token), signal: AbortSignal.timeout(8000) }); workflow.ok = wr.ok; workflow.state = wr.ok ? "verified" : "error"; workflow.message = wr.ok ? "Workflow موجود وقابل للقراءة" : wr.status === 404 ? "HTTP 404: deploy.yml غير موجود في الفرع الافتراضي — يجب دمجه في الفرع الافتراضي قبل أن يعمل dispatch" : "HTTP " + wr.status; } catch (e) { workflow.state = "connection_error"; workflow.message = e.name === "TimeoutError" ? "انتهت مهلة فحص Workflow" : e.message; }
    try { const sr = await fetch(apiUrl(s, `/environments/${encodeURIComponent(GITHUB_ENVIRONMENT)}/secrets`), { headers: ghHeaders(token), signal: AbortSignal.timeout(8000) }); const data = await sr.json().catch(() => ({})); const names = data.secrets?.map((x) => x.name) || []; const required = ["CONTABO_HOST", "CONTABO_USER", "CONTABO_SSH_KEY", "CONTABO_SSH_FINGERPRINT"]; secrets.names = names; secrets.missing = required.filter((name) => !names.includes(name)); secrets.ok = sr.ok && secrets.missing.length === 0; secrets.state = sr.ok ? (secrets.ok ? "verified" : "missing") : "error"; secrets.message = secrets.ok ? "كل Secrets المطلوبة موجودة" : "المفقود: " + (secrets.missing.join(", ") || "تعذر القراءة"); } catch (e) { secrets.state = "connection_error"; secrets.message = e.name === "TimeoutError" ? "انتهت مهلة فحص Secrets" : e.message; }
  } else { workflow.state = "blocked"; workflow.message = "يتطلب اتصال GitHub صالحاً"; secrets.state = "blocked"; secrets.message = "يتطلب اتصال GitHub صالحاً"; }
  const ssh = { ok: false, state: "missing", message: "مفتاح أو مستخدم أو بصمة غير مكتملة" };
  if (key && (s.contaboUser || s.user) && s.fingerprint) await new Promise((resolve) => { const c = new Client(); const username = s.contaboUser || s.user; const timer = setTimeout(() => { c.end(); ssh.state = "timeout"; ssh.message = "انتهت مهلة اتصال SSH"; resolve(); }, 10000); let openSshKey; try { openSshKey = toOpenSshEd25519(key); } catch (e) { ssh.state = "invalid"; ssh.message = e.message; clearTimeout(timer); resolve(); return; } c.on("ready", () => { c.exec("printf saadstudio-ssh-ok", (err, stream) => { if (err) { clearTimeout(timer); c.end(); ssh.state = "error"; ssh.message = err.message; resolve(); return; } let out = ""; stream.on("data", (b) => { out += b.toString(); }); stream.on("close", () => { clearTimeout(timer); c.end(); ssh.ok = out === "saadstudio-ssh-ok"; ssh.state = ssh.ok ? "verified" : "error"; ssh.message = ssh.ok ? "تم اختبار SSH فعلياً" : "فشل إثبات صلاحية المستخدم"; resolve(); }); }); }).on("error", (e) => { clearTimeout(timer); ssh.state = "error"; ssh.message = e.message; resolve(); }).connect({ host: s.host, port: 22, username, privateKey: openSshKey, readyTimeout: 8000, hostHash: "sha256", hostVerifier: (hash) => normalizeOpenSshFingerprint(hash) === normalizeOpenSshFingerprint(s.fingerprint) }); });
  let health; try { const hr = await fetch("https://" + s.domain + "/api/health?full=1", { signal: AbortSignal.timeout(8000) }); const body = await hr.json().catch(() => ({})); health = { ok: hr.ok && body.ok !== false, status: hr.status, message: hr.ok ? "HTTP وصحة التطبيق تم التحقق منهما" : "HTTP " + hr.status }; } catch (e) { health = { ok: false, status: 0, message: e.name === "TimeoutError" ? "انتهت مهلة فحص الموقع" : e.message }; }
  // Server-side proof (script hash + root preflight incl. Docker + verified image backup). Never inferred from file existence.
  let server = { ok: false, state: "blocked", message: "يتطلب SSH صالحاً", details: {} };
  if (ssh.ok && key) { try { server = await probeServerReadiness({ host: s.host, username: s.contaboUser || s.user, privateKey: toOpenSshEd25519(key), fingerprint: normalizeOpenSshFingerprint(s.fingerprint) }); } catch (e) { server = { ok: false, state: "error", message: e.message, details: {} }; } }
  const canRollback = github.ok && workflow.ok && secrets.ok && ssh.ok && server.ok; // rollback stays possible while the site is down (health not required)
  return { ok: canRollback && health.ok, canRollback, checkedAt, github, workflow, secrets, ssh, server, health };
}
// Hard upper bound: the UI always receives a clear verdict, never an endless "evaluating" state.
ipcMain.handle("deployment:readiness", async () => {
  const timedOut = { ok: false, canRollback: false, timedOut: true, checkedAt: new Date().toISOString(), github: { ok: false, state: "timeout", message: "انتهت مهلة الفحص الشامل" }, workflow: { ok: false, state: "timeout", message: "انتهت مهلة الفحص الشامل" }, secrets: { ok: false, state: "timeout", missing: [], names: [], message: "انتهت مهلة الفحص الشامل" }, ssh: { ok: false, state: "timeout", message: "انتهت مهلة الفحص الشامل" }, server: { ok: false, state: "timeout", message: "انتهت مهلة الفحص الشامل", details: {} }, health: { ok: false, status: 0, message: "انتهت مهلة الفحص الشامل" } };
  try { return await withDeadline(computeReadiness(), READINESS_DEADLINE_MS, timedOut); } catch (e) { return { ...timedOut, timedOut: false, github: { ok: false, state: "error", message: e.message } }; }
});
ipcMain.handle("deployments:list", async () => { const status = await githubStatus(); if (!status.ok) return { ...status, runs: [] }; const s = loadSettings(); const token = await secret("github"); try { const r = await ghFetch(apiUrl(s, `/actions/workflows/${encodeURIComponent(s.workflow)}/runs?per_page=20`), { headers: ghHeaders(token) }, 10000); const d = await r.json(); if (r.status === 401) return { ...githubStateError("expired", "انتهت جلسة GitHub، أعد الربط"), runs: [] }; if (!r.ok) return { ...githubStateError("api_error", d.message || "تعذر قراءة سجل النشر"), runs: [] }; return { ok: true, state: "connected", runs: d.workflow_runs || [] }; } catch { return { ...githubStateError("connection_error", "تعذر الاتصال بسجل GitHub"), runs: [] }; } });
ipcMain.handle("deployments:dispatch", async (_e, input) => {
  if (operation) throw new Error("توجد عملية نشر قيد التنفيذ");
  if (!input || !["deploy", "rollback"].includes(input.action)) throw new Error("عملية غير مسموحة");
  const s = loadSettings();
  const ref = String(input.ref || s.releaseBranch).trim();
  if (!REF_PATTERN.test(ref) || ref.includes("..") || ref.startsWith("-")) throw new Error("مرجع إصدار غير صالح");
  if (input.action === "rollback" && !/^[0-9a-f]{40}$/i.test(ref)) throw new Error("التراجع يتطلب SHA كامل (40 حرفاً) لإصدار سابق");
  const token = await secret("github"); if (!token) throw new Error("أدخل GitHub token في الإعدادات أولاً");
  operation = true;
  try {
    // Refuse to queue a second production run while one is queued/in progress.
    for (const status of ["in_progress", "queued"]) {
      const active = await ghFetch(apiUrl(s, `/actions/workflows/${encodeURIComponent(s.workflow)}/runs?status=${status}&per_page=1`), { headers: ghHeaders(token) }, 10000);
      if (active.ok) { const body = await active.json().catch(() => ({})); if ((body.total_count || 0) > 0) throw new Error("توجد عملية نشر أخرى قيد التنفيذ في GitHub Actions؛ انتظر اكتمالها"); }
    }
    const r = await ghFetch(apiUrl(s, `/actions/workflows/${encodeURIComponent(s.workflow)}/dispatches`), { method: "POST", headers: { ...ghHeaders(token), "Content-Type": "application/json" }, body: JSON.stringify({ ref: s.releaseBranch, inputs: { action: input.action, release_ref: ref } }) }, 15000);
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(r.status === 404 ? `Workflow غير موجود على الفرع ${s.releaseBranch} أو الفرع الافتراضي (HTTP 404)` : (d.message || `فشل تشغيل Workflow (HTTP ${r.status})`)); }
    return { ok: true, dispatchedOn: s.releaseBranch, action: input.action, release_ref: ref };
  } finally { operation = false; }
});
ipcMain.handle("server:status", async () => { const s = loadSettings(); try { const r = await fetch(`https://${s.domain}/api/health?full=1`, { signal: AbortSignal.timeout(8000) }); const d = await r.json().catch(() => ({})); return { httpStatus: r.status, ...d }; } catch (e) { throw new Error(e?.name === "TimeoutError" ? "انتهت مهلة فحص الموقع (8 ثوانٍ)" : `تعذر الوصول إلى الموقع: ${e.message}`); } });
ipcMain.handle("server:ssh-test", async () => { const s = loadSettings(); const key = await secret("ssh"); const username = s.contaboUser || s.user; if (!key || !username || !s.fingerprint) throw new Error("أكمل مستخدم النشر ومفتاح SSH وبصمة الخادم أولاً"); let openSshKey; try { openSshKey = toOpenSshEd25519(key); } catch (e) { throw new Error(`المفتاح المحفوظ غير صالح: ${e.message}`); } return new Promise((resolve, reject) => { const c = new Client(); const timer = setTimeout(() => { c.end(); reject(new Error("انتهت مهلة اتصال SSH")); }, 10000); c.on("ready", () => { c.exec("printf saadstudio-ssh-ok", (err, stream) => { if (err) { clearTimeout(timer); c.end(); return reject(err); } let out = ""; stream.on("data", (b) => { out += b.toString(); }); stream.on("close", () => { clearTimeout(timer); c.end(); resolve({ ok: out === "saadstudio-ssh-ok", user: username }); }); }); }).on("error", (e) => { clearTimeout(timer); reject(new Error(`فشل اختبار SSH للمستخدم ${username}: ${e.message}`)); }).connect({ host: s.host, port: 22, username, privateKey: openSshKey, readyTimeout: 8000, hostHash: "sha256", hostVerifier: (hash) => normalizeOpenSshFingerprint(hash) === normalizeOpenSshFingerprint(s.fingerprint) }); }); });
ipcMain.handle("server:audit:start", async (event) => {
  if (auditSessions.size) throw new Error("يوجد فحص شامل قيد التنفيذ");
  const s = loadSettings(); const key = await secret("ssh"); const username = s.contaboUser || s.user;
  if (!key || !username || !s.fingerprint) throw new Error("أكمل مفتاح SSH ومستخدم النشر وبصمة الخادم أولاً");
  const openSshKey = toOpenSshEd25519(key); const id = crypto.randomUUID();
  const session = runServerAudit({ id, host: s.host, username, privateKey: openSshKey, fingerprint: normalizeOpenSshFingerprint(s.fingerprint), onResult: (result) => event.sender.send("server:audit:event", { type: "result", ...result }), onDone: (result) => { event.sender.send("server:audit:event", { type: "done", id, ...result }); auditSessions.delete(id); } });
  auditSessions.set(id, session); return { ok: true, id };
});
ipcMain.handle("server:audit:cancel", async () => { for (const session of auditSessions.values()) session.cancel(); return { ok: true }; });
ipcMain.handle("server:repair:plan", async () => {
  const s = loadSettings(); const key = await secret("ssh"); const username = s.contaboUser || s.user;
  if (!key || !username || !s.fingerprint) throw new Error("أكمل مفتاح SSH ومستخدم النشر وبصمة الخادم أولاً");
  const openSshKey = toOpenSshEd25519(key);
  const probe = await executeRepairStep({ host: s.host, username, privateKey: openSshKey, fingerprint: normalizeOpenSshFingerprint(s.fingerprint), stepId: "proxy-detect" });
  return { plan: getRepairPlan(), probe };
});
ipcMain.handle("server:repair:apply", async (_e, input) => {
  const s = loadSettings(); const key = await secret("ssh"); const username = s.contaboUser || s.user;
  if (!key || !username || !s.fingerprint) throw new Error("أكمل مفتاح SSH ومستخدم النشر وبصمة الخادم أولاً");
  const step = getRepairPlan().find((x) => x.id === String(input?.stepId || ""));
  if (!step) throw new Error("خطوة إصلاح غير مسموحة");
  if (!input?.approved) throw new Error("لم تتم الموافقة على هذه الخطوة");
  const openSshKey = toOpenSshEd25519(key);
  return executeRepairStep({ host: s.host, username, privateKey: openSshKey, fingerprint: normalizeOpenSshFingerprint(s.fingerprint), stepId: step.id });
});
ipcMain.handle("contabo:fingerprint", async (_e, input) => { const s = loadSettings(); const password = String(input?.password || ""); const username = String(input?.user || s.user || "").trim(); if (!username || !password) throw new Error("أدخل مستخدم SSH وكلمة المرور الأولية أولاً"); return sshExec({ host: s.host, username, password, command: "printf fingerprint-check", captureFingerprint: true }); });
ipcMain.handle("contabo:setup", async (_e, input) => { const s = loadSettings(); const expected = String(input?.fingerprint || "").trim(); const bootstrapUser = String(input?.user || s.user || "").trim(); const password = String(input?.password || ""); const deployUser = s.contaboUser || "saaddeploy"; if (!USER_PATTERN.test(deployUser)) throw new Error("اسم مستخدم النشر غير صالح"); const publicKey = await secret("ssh-public"); if (!bootstrapUser || !password || !/^SHA256:[A-Za-z0-9+/=]+$/.test(expected) || !publicKey) throw new Error("أكمل مستخدم SSH وكلمة المرور والبصمة وأنشئ مفتاح Ed25519 أولاً"); const safeKey = publicKey.replace(/'/g, "'\\''"); const command = `set -eu; id -u ${deployUser} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${deployUser}; install -d -m 700 -o ${deployUser} -g ${deployUser} /home/${deployUser}/.ssh; printf '%s\\n' '${safeKey}' > /home/${deployUser}/.ssh/authorized_keys; chown ${deployUser}:${deployUser} /home/${deployUser}/.ssh/authorized_keys; chmod 600 /home/${deployUser}/.ssh/authorized_keys; install -d -m 755 /opt/saadstudio/bin /opt/saadstudio/repository /opt/saadstudio/releases; chown ${deployUser}:${deployUser} /opt/saadstudio/repository /opt/saadstudio/releases; printf setup-ok`; const result = await sshExec({ host: s.host, username: bootstrapUser, password, fingerprint: expected, command }); if (result.output.trim() !== "setup-ok") throw new Error("لم يؤكد السيرفر اكتمال الإعداد"); saveSettings({ user: bootstrapUser, fingerprint: expected }); return { ok: true, state: "provisioned", deployUser }; });
ipcMain.handle("ssh:generate", async () => { const existing = await secret("ssh"); if (existing) { const publicKey = publicEd25519Ssh(existing); await secret("ssh-public", publicKey); return { ok: true, reused: true, publicKey, algorithm: "ed25519", storedIn: "Windows Credential Manager" }; } const pair = crypto.generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" } }); const publicKey = publicEd25519Ssh(pair.privateKey); await secret("ssh", pair.privateKey); await secret("ssh-public", publicKey); return { ok: true, reused: false, publicKey, algorithm: "ed25519", storedIn: "Windows Credential Manager" }; });
ipcMain.handle("setup:github-device", async (_e, input) => { const clientId = String(input?.clientId || loadSettings().githubClientId || "").trim(); if (!/^[A-Za-z0-9_-]{10,100}$/.test(clientId)) throw new Error("أدخل GitHub OAuth Client ID لتطبيق Device Flow مسجّل؛ لا يمكن اختراعه داخل التطبيق"); const s = saveSettings({ ...input, githubClientId: clientId }); const codeResponse = await fetch("https://github.com/login/device/code", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, scope: "repo workflow" }) }); const code = await codeResponse.json(); if (!codeResponse.ok) throw new Error(code.error_description || "فشل بدء GitHub Device Flow"); return { ...code, savedSettings: s }; });
ipcMain.handle("setup:github-poll", async (_e, input) => { const clientId = String(input?.clientId || loadSettings().githubClientId || "").trim(); try { const response = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, device_code: String(input?.deviceCode || ""), grant_type: "urn:ietf:params:oauth:grant-type:device_code" }) }); const result = classifyDeviceResponse(await response.json()); if (result.ok) { await secret("github", result.access_token); return { ok: true, state: "connected", scope: result.scope }; } return result; } catch { return { ok: false, state: "connection_error", error: "تعذر الاتصال بـ GitHub أثناء التفويض" }; } });

function createWindow() {
  win = new BrowserWindow({ width: 1100, height: 760, minWidth: 850, minHeight: 620, title: "SaadStudio Deploy Manager", backgroundColor: "#08111f", webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  // The renderer must never navigate away or open child windows; external links go through shell:open-external (github.com only).
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\/github\.com\//i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("closed", () => { win = null; });
  win.loadFile(path.join(__dirname, "index.html"));
}
if (hasInstanceLock) app.whenReady().then(createWindow); app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("ssh2");

const { scrub } = require("./server-audit.cjs");

const SCRIPT_PATH = path.join(__dirname, "..", "deploy", "deploy-release.example.sh");
// Never crash or hang at startup: a missing script or a hanging `bash` (e.g. WSL stub on Windows) only disables the install step.
let SCRIPT = ""; let SCRIPT_HASH = "";
try { SCRIPT = fs.readFileSync(SCRIPT_PATH, "utf8").replace(/\r\n/g, "\n"); SCRIPT_HASH = require("crypto").createHash("sha256").update(SCRIPT).digest("hex"); } catch { /* preflight.sourceFile stays false */ }
function bashSyntaxOk() {
  if (!SCRIPT) return false;
  const candidates = process.platform === "win32" ? ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe", "bash"] : ["bash"];
  for (const bin of candidates) {
    try { const r = spawnSync(bin, ["-n", SCRIPT_PATH], { encoding: "utf8", timeout: 8000, windowsHide: true }); if (r.status === 0) return true; if (r.status !== null && r.status !== 127) return false; } catch { /* try next */ }
  }
  return false; // bash unavailable => cannot prove syntax => installation stays disabled
}
const BASH_OK = bashSyntaxOk();
const STEPS = [
  { id: "proxy-detect", title: "اكتشاف Caddy وHTTPS الفعلي", mode: "read", command: "set -o pipefail; ss -lntp 2>/dev/null; ps -eo pid,comm,args 2>/dev/null | grep -E '[c]addy|[n]ginx|[a]pache|[t]raefik' || true; curl -fsSI --max-time 8 https://saadstudio.app/; curl -fsS --max-time 8 https://saadstudio.app/api/health | head -c 200", impact: "قراءة فقط؛ يثبت عملية reverse proxy واستجابة HTTPS دون تغيير الخدمة." },
  { id: "docker-scope", title: "تحليل نطاق Docker المطلوب", mode: "read", command: "id; id saaddeploy; command -v docker || true; docker version 2>&1 | sed -n '1,18p'; grep -RniE 'docker (compose|build|up|ps)|docker compose' /opt/saadstudio/repository/.github /opt/saadstudio/repository/deploy 2>/dev/null | head -80 || true", impact: "قراءة فقط؛ لا يضيف saaddeploy إلى مجموعة docker ولا يمنحه صلاحيات root." },
  { id: "deploy-script", title: "رفع سكربت النشر إلى مجلد saaddeploy بعد تحقق SHA-256 (بدون root)", mode: "write", command: "test -s \"$T\" && printf '%s  %s\\n' '${SCRIPT_HASH}' \"$T\" | sha256sum -c - && install -m 0644 \"$T\" \"$HOME/deploy-release.staged\" && sha256sum \"$HOME/deploy-release.staged\"", impact: "يرفع السكربت إلى مجلد saaddeploy فقط بعد مطابقة SHA-256 (بدون sudo وبدون صلاحيات root). التثبيت النهائي في /opt/saadstudio/bin عملية root يدوية بموافقتك؛ لا يشغّل Deploy أو Rollback.", preflight: { bashSyntax: BASH_OK, sourceHash: Boolean(SCRIPT_HASH), sourceFile: Boolean(SCRIPT) } },
  { id: "backup-plan", title: "فحص جاهزية النسخ الاحتياطية", mode: "read", command: "command -v pg_dump || true; find /opt/saadstudio /var/backups -maxdepth 3 -type f \\( -name '*.sql*' -o -name '*.dump' \\) 2>/dev/null | head -50; test -f /opt/saadstudio/.env.production && echo 'production env present (values hidden)' || echo 'production env file not visible'; test -d /opt/saadstudio/backups && stat -c '%n owner=%U mode=%a' /opt/saadstudio/backups || echo 'backup directory missing'", impact: "قراءة فقط؛ لا ينشئ مجلداً فارغاً ولا ينسخ أو يسترجع قاعدة البيانات." },
];
function getRepairPlan() { return STEPS.map(({ id, title, mode, command, impact, preflight }) => ({ id, title, mode, command: command.replace("${SCRIPT_HASH}", SCRIPT_HASH), impact, preflight: preflight || null, requiresApproval: mode === "write" })); }
function executeRepairStep({ host, username, privateKey, fingerprint, stepId }) {
  const step = STEPS.find((x) => x.id === stepId); if (!step) throw new Error("خطوة إصلاح غير مسموحة");
  let command = step.command;
  if (stepId === "deploy-script") {
    const encoded = Buffer.from(SCRIPT, "utf8").toString("base64");
    if (!SCRIPT || !SCRIPT_HASH || !BASH_OK) throw new Error("فحوصات المصدر (وجود الملف، SHA-256، bash -n) غير مكتملة؛ التثبيت معطل");
    // Private temp file (mktemp, mode 0600) instead of a predictable /tmp name: no symlink/race attack by other local users.
    command = `set -eu; T=$(mktemp /tmp/saadstudio-deploy.XXXXXX); trap 'rm -f "$T"' EXIT; printf '%s' '${encoded}' | base64 -d > "$T"; ${command.replace("${SCRIPT_HASH}", SCRIPT_HASH)}`;
  }
  return new Promise((resolve, reject) => {
    const client = new Client(); let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; client.end(); reject(new Error("انتهت مهلة تنفيذ خطوة الإصلاح")); } }, 20000);
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); client.end(); fn(value); };
    client.on("ready", () => {
      client.exec(command, (err, stream) => {
        if (err) return finish(reject, err);
        let output = "";
        stream.on("data", (b) => { output += b.toString(); });
        stream.stderr.on("data", (b) => { output += b.toString(); });
        stream.on("close", (code) => {
          if (code === 0) finish(resolve, { ok: true, code, evidence: scrub(output) });
          else finish(reject, new Error(scrub(output) || "الأمر انتهى برمز " + code));
        });
      });
    }).on("error", (e) => finish(reject, new Error("SSH " + (e.code || "error") + ": " + e.message)));
    client.connect({ host, port: 22, username, privateKey, readyTimeout: 10000, hostHash: "sha256", hostVerifier: (hash) => { const h = String(hash); const observed = /^[0-9a-fA-F]{64}$/.test(h) ? `SHA256:${Buffer.from(h, "hex").toString("base64")}` : h.startsWith("SHA256:") ? h : `SHA256:${h}`; return observed === fingerprint; } });
  });
}

// Server-side deploy readiness, proven by running things (not by file existence):
//  - the installed script must match THIS repo's script hash
//  - the sudoers rule must allow `preflight`, and the root-run preflight must pass (docker, container, env, disk, git)
//  - the newest image backup must pass an integrity test (reported by preflight)
const PROBE_COMMAND = "h=$(sha256sum /opt/saadstudio/bin/deploy-release 2>/dev/null | cut -c1-64); echo \"installed_sha=$h\"; out=$(sudo -n /opt/saadstudio/bin/deploy-release preflight 2>&1); echo \"preflight_rc=$?\"; printf '%s\n' \"$out\" | head -30";
function parseProbe(output) {
  const lines = String(output || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const kv = {}; for (const l of lines) { const i = l.indexOf("="); if (i > 0) kv[l.slice(0, i)] = l.slice(i + 1); }
  const installed = kv.installed_sha || "";
  const out = { ok: false, state: "unverified", message: "", details: kv, scriptMatches: installed === SCRIPT_HASH, rollbackReady: false };
  if (!installed) { out.state = "script_missing"; out.message = "سكربت النشر غير مثبّت على السيرفر"; return out; }
  if (installed !== SCRIPT_HASH) { out.state = "script_outdated"; out.message = "السكربت المثبّت لا يطابق نسخة المستودع (SHA-256)"; return out; }
  if (/password is required|not allowed|may not run sudo|no tty/i.test(output)) { out.state = "sudo_denied"; out.message = "غير موثّق: قاعدة sudoers لا تسمح بـ preflight، فلا يمكن إثبات صلاحية Docker"; return out; }
  const passed = /PREFLIGHT_OK/.test(output) && kv.preflight_rc === "0";
  out.rollbackReady = /ROLLBACK_READY=yes/.test(output);
  const failing = lines.filter((l) => /FAIL|=missing|=corrupt/.test(l)).join(" | ");
  if (!passed) { out.state = "preflight_failed"; out.message = "فشل preflight: " + (failing || "راجع المخرجات"); return out; }
  if (kv.image_backup !== "verified") { out.state = "no_verified_backup"; out.message = "لا توجد نسخة صورة Docker احتياطية مُتحقَّق من سلامتها (image_backup=" + (kv.image_backup || "؟") + ")"; return out; }
  out.ok = true; out.state = "verified"; out.message = "preflight ناجح: Docker والحاوية والبيئة والمساحة والنسخة الاحتياطية المُتحقَّق منها"; return out;
}
function probeServerReadiness({ host, username, privateKey, fingerprint, timeoutMs = 25000 }) {
  return new Promise((resolve) => {
    const client = new Client(); let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { client.end(); } catch {} resolve(v); };
    const timer = setTimeout(() => finish({ ok: false, state: "timeout", message: "انتهت مهلة فحص جاهزية السيرفر", details: {} }), timeoutMs);
    client.on("ready", () => client.exec(PROBE_COMMAND, (err, stream) => {
      if (err || !stream) return finish({ ok: false, state: "error", message: err ? err.message : "تعذر تنفيذ الفحص", details: {} });
      let out = ""; stream.on("data", (b) => { out += b; }); stream.stderr.on("data", (b) => { out += b; });
      stream.on("close", () => finish(parseProbe(scrub(out))));
    })).on("error", (e) => finish({ ok: false, state: "error", message: "SSH " + (e.code || "error") + ": " + e.message, details: {} }));
    client.connect({ host, port: 22, username, privateKey, readyTimeout: 10000, hostHash: "sha256", hostVerifier: (hash) => { const h = String(hash); const o = /^[0-9a-fA-F]{64}$/.test(h) ? "SHA256:" + Buffer.from(h, "hex").toString("base64") : h.startsWith("SHA256:") ? h : "SHA256:" + h; return o === fingerprint; } });
  });
}
module.exports = { getRepairPlan, executeRepairStep, probeServerReadiness, parseProbe, getScriptHash: () => SCRIPT_HASH };

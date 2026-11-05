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
module.exports = { getRepairPlan, executeRepairStep };

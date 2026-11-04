const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { Client } = require("ssh2");

const SCRIPT = fs.readFileSync(path.join(__dirname, "..", "deploy", "deploy-release.example.sh"), "utf8");
const SCRIPT_HASH = require("crypto").createHash("sha256").update(SCRIPT).digest("hex");
const BASH_CHECK = spawnSync("bash", ["-n", path.join(__dirname, "..", "deploy", "deploy-release.example.sh")], { encoding: "utf8" });
const STEPS = [
  { id: "proxy-detect", title: "اكتشاف Caddy وHTTPS الفعلي", mode: "read", command: "set -o pipefail; ss -lntp 2>/dev/null; ps -eo pid,comm,args 2>/dev/null | grep -E '[c]addy|[n]ginx|[a]pache|[t]raefik' || true; curl -fsSI --max-time 8 https://saadstudio.app/; curl -fsS --max-time 8 https://saadstudio.app/api/health | head -c 200", impact: "قراءة فقط؛ يثبت عملية reverse proxy واستجابة HTTPS دون تغيير الخدمة." },
  { id: "docker-scope", title: "تحليل نطاق Docker المطلوب", mode: "read", command: "id; id saaddeploy; command -v docker || true; docker version 2>&1 | sed -n '1,18p'; grep -RniE 'docker (compose|build|up|ps)|docker compose' /opt/saadstudio/repository/.github /opt/saadstudio/repository/deploy 2>/dev/null | head -80 || true", impact: "قراءة فقط؛ لا يضيف saaddeploy إلى مجموعة docker ولا يمنحه صلاحيات root." },
  { id: "deploy-script", title: "تثبيت سكربت النشر بعد تحقق المصدر", mode: "write", command: "test -s /tmp/saadstudio-deploy-release && printf '%s  %s\n' '${SCRIPT_HASH}' /tmp/saadstudio-deploy-release | sha256sum -c - && sudo -n install -o root -g root -m 0750 /tmp/saadstudio-deploy-release /opt/saadstudio/bin/deploy-release && stat -c '%n owner=%U mode=%a' /opt/saadstudio/bin/deploy-release", impact: "يثبت ملفاً غير فارغ بعد مطابقة SHA-256؛ لا يشغّل Deploy أو Rollback.", preflight: { bashSyntax: BASH_CHECK.status === 0, sourceHash: Boolean(SCRIPT_HASH), sourceFile: true } },
  { id: "backup-plan", title: "فحص جاهزية النسخ الاحتياطية", mode: "read", command: "command -v pg_dump || true; find /opt/saadstudio /var/backups -maxdepth 3 -type f -name '*.sql*' -o -name '*.dump' 2>/dev/null | head -50; test -f /opt/saadstudio/.env.production && echo 'production env present (values hidden)' || echo 'production env file not visible'; test -d /opt/saadstudio/backups && stat -c '%n owner=%U mode=%a' /opt/saadstudio/backups || echo 'backup directory missing'", impact: "قراءة فقط؛ لا ينشئ مجلداً فارغاً ولا ينسخ أو يسترجع قاعدة البيانات." },
];
function scrub(s) { return String(s || "").replace(/(DATABASE_URL|DIRECT_URL|TOKEN|PASSWORD|SECRET|PRIVATE_KEY)=\S+/gi, "$1=[REDACTED]").slice(0, 12000); }
function getRepairPlan() { return STEPS.map(({ id, title, mode, command, impact, preflight }) => ({ id, title, mode, command: command.replace("${SCRIPT_HASH}", SCRIPT_HASH), impact, preflight: preflight || null, requiresApproval: mode === "write" })); }
function executeRepairStep({ host, username, privateKey, fingerprint, stepId }) {
  const step = STEPS.find((x) => x.id === stepId); if (!step) throw new Error("خطوة إصلاح غير مسموحة");
  let command = step.command;
  if (stepId === "deploy-script") {
    const encoded = Buffer.from(SCRIPT, "utf8").toString("base64");
    command = `printf '%s' '${encoded}' | base64 -d > /tmp/saadstudio-deploy-release && ${command.replace("${SCRIPT_HASH}", SCRIPT_HASH)}; rm -f /tmp/saadstudio-deploy-release`;
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

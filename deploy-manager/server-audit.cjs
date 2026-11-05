const { Client } = require("ssh2");

const CHECKS = [
  ["os", "نظام Ubuntu وحالة التشغيل", "printf 'os='; . /etc/os-release 2>/dev/null; printf '%s\\n' \"$PRETTY_NAME\"; printf 'uptime='; uptime -p"],
  ["resources", "CPU والذاكرة", "printf 'load='; cat /proc/loadavg; printf 'memory='; free -h | sed -n '1,2p'"],
  ["storage", "المساحة المتاحة", "df -hT / /opt 2>/dev/null | sed -n '1,4p'"],
  ["docker", "Docker والحاويات", "if command -v docker >/dev/null 2>&1; then docker info --format 'server={{.ServerVersion}} containers={{.Containers}} running={{.ContainersRunning}}' || exit 20; docker ps --format 'container={{.Names}} image={{.Image}} status={{.Status}} ports={{.Ports}}' || exit 20; else echo 'Docker unavailable'; exit 20; fi"],
  ["ports", "الخدمات والمنافذ", "if command -v ss >/dev/null 2>&1; then ss -lntp 2>&1 | sed -n '1,80p'; else echo 'ss unavailable'; exit 21; fi"],
  ["caddy", "Caddy وHTTPS", "set -o pipefail; ps -eo pid,comm,args 2>/dev/null | grep -E '[c]addy run' || true; systemctl is-active caddy 2>/dev/null || true; systemctl is-enabled caddy 2>/dev/null || true; if command -v caddy >/dev/null 2>&1 && test -r /etc/caddy/Caddyfile; then caddy validate --config /etc/caddy/Caddyfile 2>&1 || true; fi; curl -fsSI --max-time 8 https://saadstudio.app/ | grep -Ei '^HTTP/|^server:|^strict-transport-security:'; curl -fsS --max-time 8 https://saadstudio.app/api/health | head -c 200"],
  ["app", "مسار وطريقة تشغيل SaadStudio", "for p in /opt/saadstudio /opt/saadstudio/repository /opt/saadstudio/releases; do test -e \"$p\" && stat -c '%n type=%F owner=%U mode=%a' \"$p\"; done; systemctl list-units --type=service --all --no-legend 2>/dev/null | grep -Ei 'saad|next|caddy' || true"],
  ["health", "حالة التطبيق وHealth API", "curl -fsS --max-time 8 'https://saadstudio.app/api/health?full=1' 2>&1 || { echo 'health request failed'; exit 23; }"],
  ["database", "دلالة اتصال قاعدة البيانات", "curl -fsS --max-time 8 'https://saadstudio.app/api/health?full=1' 2>&1 | tr '\\n' ' ' | grep -Eio 'database[^,}]*|db[^,}]*|healthy|ok' | head -20 || echo 'database state not exposed by health endpoint'"],
  ["deploy-script", "سكربت النشر والتراجع", "if test -f /opt/saadstudio/bin/deploy-release; then stat -c '%n owner=%U mode=%a executable=%A' /opt/saadstudio/bin/deploy-release; sed -n '1,220p' /opt/saadstudio/bin/deploy-release | grep -E '^(#!/|RELEASE|rollback|deploy|ln |mv |cp |rm |docker|systemctl|health|curl)' | head -100; else echo 'Deployment script missing'; exit 24; fi"],
  ["releases", "الإصدارات والنسخ الاحتياطية", "for p in /opt/saadstudio/releases /opt/saadstudio/backups /var/backups/saadstudio; do if test -d \"$p\"; then echo \"[$p]\"; find \"$p\" -maxdepth 1 -mindepth 1 -printf '%f %y %TY-%Tm-%Td\\n' 2>/dev/null | sort -r | head -30; else echo \"missing=$p\"; fi; done"],
  ["conflicts", "تعارض المنافذ 3000 و3002", "ss -lntp 2>/dev/null | grep -E ':(3000|3002)\\b' || echo 'ports 3000/3002 not listening'"],
  ["workflow", "مطابقة Workflow مع الخادم", "test -x /opt/saadstudio/bin/deploy-release && echo 'deploy-script executable'; test -d /opt/saadstudio/releases && echo 'releases-directory present'; grep -Ril 'saadstudio' /opt/saadstudio 2>/dev/null | head -20"],
];
function normalizeFingerprint(value) {
  const text = String(value || "").trim();
  if (text.startsWith("SHA256:")) return text;
  // ssh2 passes a hex digest when hostHash is set; the stored OpenSSH form is base64.
  if (/^[0-9a-fA-F]{64}$/.test(text)) return `SHA256:${Buffer.from(text, "hex").toString("base64")}`;
  return text;
}

function scrub(value) {
  // NOTE: the previous pattern used [^\\s]* inside a regex literal, which stops at the letter "s" and leaked secret tails.
  return String(value || "")
    .replace(/([A-Z0-9_]*(?:DATABASE_URL|DIRECT_URL|TOKEN|PASSWORD|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*=\s*\S*/gi, "$1=[REDACTED]")
    .replace(/(["']?(?:password|token|secret|api[_-]?key|authorization)["']?\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"')
    .replace(/\b(postgres(?:ql)?|mysql|redis|mongodb(?:\+srv)?):\/\/[^\s'"]+/gi, "$1://[REDACTED]")
    .replace(/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .slice(0, 12000);
}

function runCommand(client, command, timeoutMs, cancelled) {
  return new Promise((resolve) => {
    if (cancelled()) return resolve({ ok: false, state: "BLOCKED", message: "تم إلغاء الفحص" });
    let timer; let stdout = ""; let stderr = ""; let settled = false;
    const finish = (result) => { if (settled) return; settled = true; clearTimeout(timer); resolve(result); };
    timer = setTimeout(() => finish({ ok: false, state: "BLOCKED", message: `انتهت مهلة الفحص (${timeoutMs}ms)`, code: "timeout" }), timeoutMs);
    client.exec(command, (error, stream) => {
      if (error) return finish({ ok: false, state: "FAIL", message: error.message, stdout: "", stderr: error.message, exitCode: null });
      stream.on("data", (chunk) => { stdout += chunk.toString(); });
      stream.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      stream.on("close", (code) => {
        const evidence = scrub([stdout, stderr].filter(Boolean).join("\n"));
        finish({ ok: code === 0, state: code === 0 ? "PASS" : "FAIL", message: code === 0 ? "تم الفحص" : `الأمر انتهى برمز ${code}`, stdout: scrub(stdout), stderr: scrub(stderr), exitCode: code, evidence });
      });
    });
  });
}
function applyEvidenceSemantics(key, result) {
  if (key === "releases") {
    const text = `${result.stdout || ""}\n${result.stderr || ""}`;
    if (/missing=\/opt\/saadstudio\/backups|missing=\/var\/backups\/saadstudio/.test(text)) return { ...result, state: "WARNING", ok: false, message: "لم تثبت نسخ احتياطية فعلية؛ توجد مسارات مفقودة" };
    return result;
  }
  if (key === "database") {
    const text = `${result.stdout || ""}`;
    if (!/database|db/i.test(text)) return { ...result, state: "UNVERIFIED", ok: false, message: "Health API لم يعرض دليلاً على حالة قاعدة البيانات" };
    return result;
  }
  if (key !== "caddy") return result;
  const text = `${result.stdout || ""}\n${result.stderr || ""}`;
  // The site root answers 307 (redirect to the app); a 3xx from Caddy is a healthy HTTPS response, not a failure.
  const httpsOk = /^HTTP\/\d(?:\.\d)?\s+[23]\d\d/m.test(text) && /"ok"\s*:\s*true/.test(text);
  const caddyProcess = /caddy\s+run/.test(text);
  if (httpsOk && caddyProcess) return { ...result, ok: true, state: "PASS", message: "HTTPS وCaddy يعملان فعلياً؛ Caddy قد لا يكون systemd service" };
  return { ...result, ok: false, state: httpsOk ? "WARNING" : "FAIL", message: httpsOk ? "HTTPS يعمل لكن عملية Caddy لم تثبت في المخرجات" : "لم يثبت تشغيل HTTPS وHealth API مع Caddy" };
}

function runServerAudit({ id, host, username, privateKey, fingerprint, onResult, onDone }) {
  const client = new Client(); let cancelled = false; let finished = false;
  const finish = (result) => { if (finished) return; finished = true; try { client.end(); } catch {} onDone(result); };
  const cancel = () => { cancelled = true; try { client.end(); } catch {} };
  const promise = new Promise((resolve) => {
    const timer = setTimeout(() => { finish({ state: "BLOCKED", message: "انتهت مهلة اتصال SSH" }); resolve(); }, 15000);
    client.on("ready", async () => {
      clearTimeout(timer);
      for (const [key, name, command] of CHECKS) {
        if (cancelled) break;
        const started = Date.now();
        const result = applyEvidenceSemantics(key, await runCommand(client, command, key === "health" || key === "database" ? 12000 : 8000, () => cancelled));
        onResult({ id, key, name, ...result, durationMs: Date.now() - started, at: new Date().toISOString() });
      }
      finish({ state: cancelled ? "BLOCKED" : "DONE", message: cancelled ? "تم إلغاء الفحص" : "اكتمل الفحص" }); resolve();
    }).on("error", (error) => { clearTimeout(timer); finish({ state: "BLOCKED", message: `SSH ${error.code || "error"}: ${error.message}` }); resolve(); });
    client.connect({ host, port: 22, username, privateKey, readyTimeout: 10000, hostHash: "sha256", hostVerifier: (hash) => normalizeFingerprint(hash) === normalizeFingerprint(fingerprint) });
  });
  return { promise, cancel };
}

module.exports = { runServerAudit, scrub };

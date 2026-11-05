// Direct SSH deploy: Deploy Manager -> SSH (pinned host key, user saaddeploy) -> `sudo -n deploy-release <action> <sha>`.
// No GitHub Actions involved. The only privileged thing that ever runs is the audited script behind ONE sudoers rule.
const fs = require("fs");
const { Client } = require("ssh2");
const { scrub } = require("./server-audit.cjs");

const DEPLOY_SCRIPT = "/opt/saadstudio/bin/deploy-release";
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ACTIONS = ["deploy", "rollback"];
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000; // image build can take minutes

// The ONLY command this module ever sends for a deploy: fixed script path, allowlisted action, full 40-hex SHA.
function buildRemoteCommand(action, sha) {
  if (!ACTIONS.includes(action)) throw new Error("عملية غير مسموحة");
  if (!SHA_PATTERN.test(String(sha || ""))) throw new Error("يلزم SHA كامل (40 حرفاً)");
  return `sudo -n ${DEPLOY_SCRIPT} ${action} ${sha} 2>&1`;
}

function normalizeObserved(hash) {
  const h = String(hash);
  return /^[0-9a-fA-F]{64}$/.test(h) ? `SHA256:${Buffer.from(h, "hex").toString("base64")}` : h.startsWith("SHA256:") ? h : `SHA256:${h}`;
}

// Streams scrubbed output through onData. Resolves {ok, code, output, state}:
//  state "finished" (remote exit code known) | "timeout" | "disconnected" (outcome UNKNOWN: remote may still be running).
function runRemote({ host, username, privateKey, fingerprint, command, onData = () => {}, timeoutMs = DEFAULT_TIMEOUT_MS, ClientCtor = Client }) {
  return new Promise((resolve) => {
    const client = new ClientCtor(); let done = false; let output = "";
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { client.end(); } catch {} resolve({ ...v, output: scrub(output) }); };
    const timer = setTimeout(() => finish({ ok: false, code: null, state: "timeout" }), timeoutMs);
    client.on("ready", () => client.exec(command, (err, stream) => {
      if (err || !stream) return finish({ ok: false, code: null, state: "error", error: err ? err.message : "تعذر تنفيذ الأمر" });
      const push = (b) => { const t = b.toString(); output += t; try { onData(scrub(t)); } catch { /* UI listener errors must not break the deploy */ } };
      stream.on("data", push); stream.stderr.on("data", push);
      stream.on("close", (code) => finish({ ok: code === 0, code, state: code === null || code === undefined ? "disconnected" : "finished" }));
    })).on("error", (e) => finish({ ok: false, code: null, state: output ? "disconnected" : "error", error: "SSH " + (e.code || "error") + ": " + e.message }));
    client.connect({ host, port: 22, username, privateKey, readyTimeout: 10000, keepaliveInterval: 15000, hostHash: "sha256", hostVerifier: (hash) => normalizeObserved(hash) === fingerprint });
  });
}

// GitHub commit JSON -> what the user must confirm.
function parseCommit(json) {
  const sha = String(json?.sha || "");
  if (!SHA_PATTERN.test(sha)) throw new Error("GitHub لم يُرجع SHA صالحاً للفرع");
  return { sha, subject: String(json?.commit?.message || "").split("\n")[0].slice(0, 160), author: String(json?.commit?.author?.name || ""), date: String(json?.commit?.author?.date || "") };
}

// Health verdict from /api/health?full=1
function healthVerdict(status, body) {
  const bad = body && (body.ok === false || body.status === "error" || body.database === "error");
  return { ok: status === 200 && !bad, status };
}
async function waitForHealth(check, { attempts = 12, delayMs = 5000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let last = { ok: false, status: 0 };
  for (let i = 0; i < attempts; i++) { try { last = await check(); } catch (e) { last = { ok: false, status: 0, error: e.message }; } if (last.ok) return last; if (i < attempts - 1) await sleep(delayMs); }
  return last;
}

// Local deploy history (the rollback target is the previous SUCCESSFUL deploy).
function readHistory(file) { try { const d = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(d) ? d.filter((x) => SHA_PATTERN.test(x?.sha || "")) : []; } catch { return []; } }
function appendHistory(file, entry) { const list = readHistory(file); list.unshift({ sha: entry.sha, action: entry.action, ok: Boolean(entry.ok), healthy: Boolean(entry.healthy), at: entry.at || new Date().toISOString() }); fs.writeFileSync(file, JSON.stringify(list.slice(0, 50), null, 1), { mode: 0o600 }); return list; }
// Previous successful, healthy release whose sha differs from the one currently live (newest successful deploy/rollback).
function pickRollbackFromHistory(list) {
  const good = (list || []).filter((x) => x.ok && x.healthy);
  if (!good.length) return null;
  const current = good[0].sha;
  return good.find((x) => x.sha !== current) || null;
}

// ---- persistent, scrubbed deploy logs (userData/deploy-logs) ----------------------------------
const LOG_NAME = /^\d{8}-\d{6}-(deploy|rollback)-[0-9a-f]{8}-(success|deployed_unhealthy|failed|unknown)\.log$/;
function saveLog(dir, { action, sha, outcome, output, exitCode, health, at = new Date() }) {
  if (!ACTIONS.includes(action) || !SHA_PATTERN.test(sha)) throw new Error("بيانات سجل غير صالحة");
  fs.mkdirSync(dir, { recursive: true });
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  const name = `${stamp}-${action}-${sha.slice(0, 8)}-${outcome}.log`;
  const header = `# ${action} ${sha}\n# outcome=${outcome} exit=${exitCode ?? "unknown"} site_http=${health?.status ?? "?"} at=${at.toISOString()}\n\n`;
  fs.writeFileSync(`${dir}/${name}`, header + scrub(output || ""), { mode: 0o600 });
  return name;
}
function listLogs(dir, limit = 20) { try { return fs.readdirSync(dir).filter((n) => LOG_NAME.test(n)).sort().reverse().slice(0, limit); } catch { return []; } }
function readLog(dir, name) { if (!LOG_NAME.test(String(name || ""))) throw new Error("اسم سجل غير صالح"); return fs.readFileSync(`${dir}/${name}`, "utf8").slice(0, 200000); }
// `readlink /opt/saadstudio/current` -> deployed sha (root-releases/<sha>)
const DEPLOYED_COMMAND = "readlink /opt/saadstudio/current 2>/dev/null || true";
function parseDeployedSha(output) { const m = /root-releases\/([0-9a-f]{40})\b/.exec(String(output || "")); return m ? m[1] : ""; }

module.exports = { saveLog, listLogs, readLog, parseDeployedSha, DEPLOYED_COMMAND, buildRemoteCommand, runRemote, parseCommit, healthVerdict, waitForHealth, readHistory, appendHistory, pickRollbackFromHistory, SHA_PATTERN, DEPLOY_SCRIPT, normalizeObserved };

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("os"); const fs = require("fs"); const path = require("path");
const { EventEmitter } = require("events");
const d = require("./direct-deploy.cjs");

const SHA = "a".repeat(40);

test("buildRemoteCommand only produces the fixed sudo command for allowlisted input", () => {
  assert.equal(d.buildRemoteCommand("deploy", SHA), `sudo -n /opt/saadstudio/bin/deploy-release deploy ${SHA} 2>&1`);
  assert.equal(d.buildRemoteCommand("rollback", SHA), `sudo -n /opt/saadstudio/bin/deploy-release rollback ${SHA} 2>&1`);
  for (const bad of ["migration/contabo", "abc", SHA + "a", SHA.slice(1), `${SHA}; id`, "$(id)" + "a".repeat(35), "A".repeat(40), "-x" + "a".repeat(38), ""]) {
    assert.throws(() => d.buildRemoteCommand("deploy", bad), /SHA/, `sha ${JSON.stringify(bad)} must be rejected`);
  }
  for (const action of ["preflight", "bogus", "deploy; id", "", undefined]) assert.throws(() => d.buildRemoteCommand(action, SHA), /غير مسموحة/);
});

test("parseCommit and healthVerdict", () => {
  assert.deepEqual(d.parseCommit({ sha: SHA, commit: { message: "feat: x\n\nbody", author: { name: "A", date: "2026-11-05T00:00:00Z" } } }), { sha: SHA, subject: "feat: x", author: "A", date: "2026-11-05T00:00:00Z" });
  assert.throws(() => d.parseCommit({ sha: "nope" }), /SHA/);
  assert.equal(d.healthVerdict(200, { ok: true }).ok, true);
  assert.equal(d.healthVerdict(200, {}).ok, true);
  assert.equal(d.healthVerdict(200, { ok: false }).ok, false);
  assert.equal(d.healthVerdict(502, {}).ok, false);
});

test("waitForHealth retries then succeeds, and gives up with the last verdict", async () => {
  let n = 0; const sleeps = [];
  const ok = await d.waitForHealth(async () => ({ ok: ++n >= 3, status: n >= 3 ? 200 : 502 }), { attempts: 5, delayMs: 1, sleep: async (ms) => sleeps.push(ms) });
  assert.equal(ok.ok, true); assert.equal(n, 3); assert.equal(sleeps.length, 2);
  const bad = await d.waitForHealth(async () => { throw new Error("down"); }, { attempts: 2, delayMs: 1, sleep: async () => {} });
  assert.equal(bad.ok, false); assert.match(bad.error, /down/);
});

test("history: rollback target is the previous healthy release, never the current or a failed one", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dh-")), "h.json");
  assert.deepEqual(d.readHistory(f), []);
  const a = "1".repeat(40), b = "2".repeat(40), c = "3".repeat(40);
  d.appendHistory(f, { sha: a, action: "deploy", ok: true, healthy: true });
  assert.equal(d.pickRollbackFromHistory(d.readHistory(f)), null, "only one release: nothing to roll back to");
  d.appendHistory(f, { sha: b, action: "deploy", ok: true, healthy: true });
  d.appendHistory(f, { sha: c, action: "deploy", ok: false, healthy: false }); // failed deploy (script restored b)
  assert.equal(d.pickRollbackFromHistory(d.readHistory(f)).sha, a);
  fs.writeFileSync(f, "not json"); assert.deepEqual(d.readHistory(f), []);
});

// ---- fake ssh2 client -------------------------------------------------------------------------
function fakeClient({ chunks = [], code = 0, execError = null, connectError = null, hang = false, closeNoCode = false }) {
  return class FakeClient extends EventEmitter {
    connect(opts) {
      FakeClient.opts = opts;
      setImmediate(() => {
        if (connectError) return this.emit("error", Object.assign(new Error(connectError), { code: "ECONNRESET" }));
        this.emit("ready");
      });
    }
    exec(command, cb) {
      FakeClient.command = command;
      if (execError) return cb(new Error(execError));
      const stream = new EventEmitter(); stream.stderr = new EventEmitter(); cb(null, stream);
      if (hang) return;
      setImmediate(() => { for (const c of chunks) stream.emit("data", Buffer.from(c)); stream.emit("close", closeNoCode ? null : code); });
    }
    end() {}
  };
}
const base = { host: "h", username: "saaddeploy", privateKey: "k", fingerprint: "SHA256:abc", command: d.buildRemoteCommand("deploy", SHA) };

test("runRemote streams scrubbed output, reports exit code and pins the host key", async () => {
  const C = fakeClient({ chunks: ["building\n", "DATABASE_URL=postgres://u:p@h/db\n", "deployed\n"], code: 0 });
  const seen = [];
  const r = await d.runRemote({ ...base, ClientCtor: C, onData: (t) => seen.push(t) });
  assert.equal(r.ok, true); assert.equal(r.code, 0); assert.equal(r.state, "finished");
  assert.ok(seen.length === 3 && !seen.join("").includes("postgres://u:p"), "secrets must be scrubbed in the stream");
  assert.ok(!r.output.includes("postgres://u:p"));
  assert.equal(C.command, base.command);
  assert.equal(C.opts.hostHash, "sha256");
  // host-key verifier: only the pinned fingerprint passes
  const hex = Buffer.from("abc").toString("hex").padEnd(64, "0");
  assert.equal(C.opts.hostVerifier("SHA256:abc"), true);
  assert.equal(C.opts.hostVerifier("SHA256:other"), false);
  assert.equal(C.opts.hostVerifier(hex), false);
});

test("runRemote: non-zero exit, exec error, connect error, timeout, dropped connection", async () => {
  let r = await d.runRemote({ ...base, ClientCtor: fakeClient({ chunks: ["health check failed; restoring previous release\n"], code: 1 }) });
  assert.equal(r.ok, false); assert.equal(r.code, 1); assert.equal(r.state, "finished");
  r = await d.runRemote({ ...base, ClientCtor: fakeClient({ execError: "boom" }) });
  assert.equal(r.ok, false); assert.equal(r.state, "error");
  r = await d.runRemote({ ...base, ClientCtor: fakeClient({ connectError: "reset" }) });
  assert.equal(r.ok, false); assert.equal(r.state, "error"); assert.match(r.error, /ECONNRESET/);
  r = await d.runRemote({ ...base, timeoutMs: 20, ClientCtor: fakeClient({ hang: true }) });
  assert.equal(r.ok, false); assert.equal(r.state, "timeout");
  r = await d.runRemote({ ...base, ClientCtor: fakeClient({ chunks: ["partial\n"], closeNoCode: true }) });
  assert.equal(r.ok, false); assert.equal(r.state, "disconnected", "no exit code => outcome unknown, never reported as success");
});

test("parseProbe: a running deploy (preflight rc 3) is reported as busy, not as a server fault", () => {
  const { parseProbe, getScriptHash } = require("./server-repair.cjs");
  const h = getScriptHash();
  const busy = parseProbe(`installed_sha=${h}\npreflight_rc=3\nanother deployment is running\n`);
  assert.equal(busy.state, "busy"); assert.equal(busy.ok, false);
  const ok = parseProbe(`installed_sha=${h}\npreflight_rc=0\nenv_file=ok\ndocker=ok\nimage_backup=verified\nROLLBACK_READY=yes\nPREFLIGHT_OK\n`);
  assert.equal(ok.ok, true);
});

test("logs: saved scrubbed, listed newest first, path traversal and bad names rejected", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dl-")), "logs");
  const n1 = d.saveLog(dir, { action: "deploy", sha: SHA, outcome: "success", output: "ok\nDATABASE_URL=postgres://u:secretpw@h/db\n", exitCode: 0, health: { status: 200 }, at: new Date(2026, 10, 5, 10, 0, 0) });
  const n2 = d.saveLog(dir, { action: "rollback", sha: "b".repeat(40), outcome: "failed", output: "x", exitCode: 1, health: { status: 502 }, at: new Date(2026, 10, 5, 11, 0, 0) });
  assert.deepEqual(d.listLogs(dir), [n2, n1]);
  const text = d.readLog(dir, n1);
  assert.match(text, /outcome=success/); assert.ok(!text.includes("secretpw"), "secrets must never reach disk");
  for (const bad of ["../x.log", "..\\x.log", "a.log", n1 + "/../../etc", "", undefined]) assert.throws(() => d.readLog(dir, bad), /غير صالح/);
  assert.throws(() => d.saveLog(dir, { action: "preflight", sha: SHA, outcome: "success" }), /غير صالحة/);
  assert.deepEqual(d.listLogs(path.join(dir, "missing")), []);
});

test("parseDeployedSha reads the release symlink target", () => {
  assert.equal(d.parseDeployedSha(`/opt/saadstudio/root-releases/${SHA}\n`), SHA);
  assert.equal(d.parseDeployedSha(""), ""); assert.equal(d.parseDeployedSha("/etc/passwd"), "");
});

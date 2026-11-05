// Run: node --test deploy-manager/audit-fixes.test.cjs   (no Electron needed)
const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const nacl = require("tweetnacl");
const { blake2b } = require("blakejs");
const { utils } = require("ssh2");
const { scrub } = require("./server-audit.cjs");
const { encryptGithubSecret } = require("./github-secret.cjs");
const { toOpenSshEd25519 } = require("./ssh-key-format.cjs");
const { getRepairPlan } = require("./server-repair.cjs");

test("scrub hides the full secret (old regex stopped at the letter s)", () => {
  const out = scrub("API_TOKEN=abcsdefsghi\nDATABASE_URL=postgresql://u:p@h/db?x=1\n{\"password\":\"hunter2\"}\npostgres://a:b@c/d");
  for (const leak of ["abcsdefsghi", "defsghi", "u:p@h", "hunter2", "a:b@c"]) assert.ok(!out.includes(leak), `leaked ${leak}: ${out}`);
});
test("GitHub secret encryption follows the libsodium crypto_box_seal spec", () => {
  const kp = nacl.box.keyPair();
  const raw = new Uint8Array(Buffer.from(encryptGithubSecret("TOP-SECRET-VALUE", Buffer.from(kp.publicKey).toString("base64")), "base64"));
  const epk = raw.slice(0, 32); const ciphertext = raw.slice(32);
  const nonce = blake2b(Buffer.concat([Buffer.from(epk), Buffer.from(kp.publicKey)]), undefined, 24); // spec: nonce = BLAKE2b-24(epk || recipient_pk)
  const opened = nacl.box.open(ciphertext, nonce, epk, kp.secretKey);
  assert.ok(opened, "recipient could not open the sealed box");
  assert.strictEqual(Buffer.from(opened).toString(), "TOP-SECRET-VALUE");
});
test("PKCS8 Ed25519 converts to an OpenSSH key that ssh2 parses", () => {
  const { privateKey } = crypto.generateKeyPairSync("ed25519", { privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const parsed = utils.parseKey(toOpenSshEd25519(privateKey));
  assert.ok(!(parsed instanceof Error), parsed.message);
  assert.strictEqual(parsed.type, "ssh-ed25519");
});
test("repair plan never escalates to root or touches docker group", () => {
  const plan = getRepairPlan();
  assert.ok(plan.length >= 4);
  for (const step of plan) { assert.ok(!/\bsudo\b|usermod|gpasswd|adduser|chmod\s+[0-7]*7[0-7]*\s+\/|rm\s+-rf/.test(step.command), `${step.id}: ${step.command}`); }
  const write = plan.filter((s) => s.mode === "write");
  assert.ok(write.every((s) => s.requiresApproval));
});

const { parseProbe, getScriptHash } = require("./server-repair.cjs");
test("server readiness is never granted from file existence or forged output", () => {
  const H = getScriptHash(); const ok = (s) => parseProbe(s).ok;
  assert.strictEqual(ok("installed_sha=\npreflight_rc=1"), false);                                            // script missing
  assert.strictEqual(ok("installed_sha=" + "a".repeat(64) + "\npreflight_rc=0\nPREFLIGHT_OK\nimage_backup=verified"), false); // wrong hash
  assert.strictEqual(ok("installed_sha=" + H + "\npreflight_rc=1\nsudo: a password is required"), false);     // sudoers lacks preflight
  assert.strictEqual(ok("installed_sha=" + H + "\npreflight_rc=6\ndocker=FAIL\nPREFLIGHT_FAIL"), false);       // docker failing
  assert.strictEqual(ok("installed_sha=" + H + "\npreflight_rc=0\nPREFLIGHT_OK\nimage_backup=missing"), false); // no verified backup
  assert.strictEqual(ok("installed_sha=" + H + "\nPREFLIGHT_OK\nimage_backup=verified"), false);              // no exit code => forged
  assert.strictEqual(ok("installed_sha=" + H + "\npreflight_rc=0\ndocker=ok\nimage_backup=verified\nPREFLIGHT_OK"), true);
});

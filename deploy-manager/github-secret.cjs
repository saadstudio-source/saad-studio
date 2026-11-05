const nacl = require("tweetnacl");
const { blake2b } = require("blakejs");

/** Encrypt a value for the GitHub Actions secrets API (libsodium sealed box, nonce = BLAKE2b(epk || rpk)[0..24]). */
function encryptGithubSecret(value, publicKeyBase64) {
  const recipient = Buffer.from(publicKeyBase64, "base64");
  if (recipient.length !== nacl.box.publicKeyLength) throw new Error("مفتاح GitHub العام غير صالح");
  const ephemeral = nacl.box.keyPair();
  const nonce = Buffer.from(blake2b(Buffer.concat([Buffer.from(ephemeral.publicKey), recipient]), undefined, 24));
  const shared = nacl.box.before(new Uint8Array(recipient), ephemeral.secretKey);
  const sealed = nacl.box.after(Buffer.from(value), nonce, shared);
  return Buffer.concat([Buffer.from(ephemeral.publicKey), Buffer.from(sealed)]).toString("base64");
}
module.exports = { encryptGithubSecret };

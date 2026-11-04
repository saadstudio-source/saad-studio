const crypto = require("crypto");

function field(value) {
  const data = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, data]);
}

/** Convert the stored PKCS#8 Ed25519 key to OpenSSH format in memory. */
function toOpenSshEd25519(privateKey) {
  const key = crypto.createPrivateKey(privateKey);
  if (key.asymmetricKeyType !== "ed25519") throw new Error("مفتاح SSH ليس Ed25519");
  const jwk = key.export({ format: "jwk" });
  const publicKey = Buffer.from(jwk.x, "base64url");
  const seed = Buffer.from(jwk.d, "base64url");
  if (publicKey.length !== 32 || seed.length !== 32) throw new Error("صيغة مفتاح Ed25519 غير صالحة");

  const publicBlob = Buffer.concat([field("ssh-ed25519"), field(publicKey)]);
  const check = crypto.randomBytes(4);
  const privateBlob = Buffer.concat([
    check, check,
    field("ssh-ed25519"), field(publicKey), field(Buffer.concat([seed, publicKey])), field("saadstudio-deploy")
  ]);
  const paddingLength = (8 - (privateBlob.length % 8)) % 8;
  const padding = Buffer.from(Array.from({ length: paddingLength }, (_, i) => i + 1));
  const payload = Buffer.concat([
    Buffer.from("openssh-key-v1\0"), field("none"), field("none"), field(Buffer.alloc(0)),
    (() => { const n = Buffer.alloc(4); n.writeUInt32BE(1); return n; })(),
    field(publicBlob), field(Buffer.concat([privateBlob, padding]))
  ]);
  const encoded = payload.toString("base64").match(/.{1,70}/g).join("\n");
  return `-----BEGIN OPENSSH PRIVATE KEY-----\n${encoded}\n-----END OPENSSH PRIVATE KEY-----\n`;
}

module.exports = { toOpenSshEd25519 };

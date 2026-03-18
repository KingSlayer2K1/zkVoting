const crypto = require("crypto");

function randomFieldElement() {
  // 31 bytes keeps values safely in the bn128 scalar field range for this prototype.
  const hex = crypto.randomBytes(31).toString("hex");
  return BigInt(`0x${hex}`).toString();
}

function getVoteEncryptionKey() {
  const keyMaterial =
    process.env.VOTE_ENCRYPTION_KEY || "zkVoting-dev-only-key-change-me";
  return crypto.createHash("sha256").update(keyMaterial).digest();
}

function encryptVotePayload(payload) {
  const key = getVoteEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("base64"),
    ciphertext: encrypted.toString("base64"),
    tag: tag.toString("base64"),
  };
}

function decryptVotePayload(sealedPayload) {
  const key = getVoteEncryptionKey();
  const iv = Buffer.from(sealedPayload.iv, "base64");
  const ciphertext = Buffer.from(sealedPayload.ciphertext, "base64");
  const tag = Buffer.from(sealedPayload.tag, "base64");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");

  return JSON.parse(plaintext);
}

module.exports = {
  randomFieldElement,
  encryptVotePayload,
  decryptVotePayload,
};

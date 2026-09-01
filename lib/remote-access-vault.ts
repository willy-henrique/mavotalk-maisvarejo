import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

function encryptionKey(): Buffer {
  const encoded = String(process.env.MAVO_REMOTE_ACCESS_ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("Cofre de acessos não configurado. Defina MAVO_REMOTE_ACCESS_ENCRYPTION_KEY com 32 bytes em base64.");
  }
  return key;
}

export function encryptRemoteAccessSecret(secret: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: 1,
  };
}

export function decryptRemoteAccessSecret(value: {
  ciphertext: string;
  iv: string;
  authTag: string;
}): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

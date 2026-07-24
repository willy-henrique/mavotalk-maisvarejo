import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export type EncryptedWhatsappAuthValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function binaryJsonReplacer(_key: string, value: unknown): unknown {
  if (
    Buffer.isBuffer(value) ||
    value instanceof Uint8Array ||
    (value &&
      typeof value === "object" &&
      "type" in value &&
      value.type === "Buffer" &&
      "data" in value)
  ) {
    const binary = value as
      | Uint8Array
      | { type: "Buffer"; data: string | ArrayLike<number> };
    const data = "data" in binary ? binary.data : binary;
    const encoded =
      typeof data === "string"
        ? Buffer.from(data, "base64")
        : Buffer.from(data);
    return {
      type: "Buffer",
      data: encoded.toString("base64"),
    };
  }
  return value;
}

function binaryJsonReviver(_key: string, value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "Buffer" &&
    "data" in value &&
    typeof value.data === "string"
  ) {
    return Buffer.from(value.data, "base64");
  }
  return value;
}

function encryptionKey(keyMaterial: string): Buffer {
  const value = String(keyMaterial || "").trim();
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(
      "WHATSAPP_AUTH_ENCRYPTION_KEY deve conter ao menos 32 caracteres",
    );
  }
  return createHash("sha256").update(value, "utf8").digest();
}

function additionalAuthenticatedData(context: string): Buffer {
  const value = String(context || "").trim();
  if (!value) {
    throw new Error("Contexto da sessão WhatsApp é obrigatório");
  }
  return Buffer.from(value, "utf8");
}

export function serializeWhatsappAuthValue(value: unknown): string {
  return JSON.stringify(value, binaryJsonReplacer);
}

export function deserializeWhatsappAuthValue<T>(value: string): T {
  return JSON.parse(value, binaryJsonReviver) as T;
}

export function encryptWhatsappAuthValue(
  value: unknown,
  keyMaterial: string,
  context: string,
): EncryptedWhatsappAuthValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    encryptionKey(keyMaterial),
    iv,
  );
  cipher.setAAD(additionalAuthenticatedData(context));
  const encrypted = Buffer.concat([
    cipher.update(serializeWhatsappAuthValue(value), "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptWhatsappAuthValue<T>(
  value: EncryptedWhatsappAuthValue,
  keyMaterial: string,
  context: string,
): T {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(keyMaterial),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(additionalAuthenticatedData(context));
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return deserializeWhatsappAuthValue<T>(
    Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8"),
  );
}

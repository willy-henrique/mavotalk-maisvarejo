import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalAgentRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    input.nonce,
    sha256Hex(input.rawBody),
  ].join("\n");
}

export function signAgentRequest(
  secret: string,
  input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    rawBody: string;
  },
): string {
  return createHmac("sha256", secret)
    .update(canonicalAgentRequest(input))
    .digest("hex");
}

export function verifyAgentSignature(
  secret: string,
  signature: string,
  input: {
    method: string;
    path: string;
    timestamp: string;
    nonce: string;
    rawBody: string;
  },
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signAgentRequest(secret, input), "hex");
  const received = Buffer.from(signature, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

function encryptionKey(explicitKey?: string): Buffer {
  const encoded =
    explicitKey || process.env.MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY || "";
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error(
      "MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY deve conter 32 bytes em base64",
    );
  }
  return key;
}

export function encryptAgentSecret(
  secret: string,
  explicitKey?: string,
): {
  ciphertext: string;
  iv: string;
  authTag: string;
  fingerprint: string;
} {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(explicitKey), iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    fingerprint: sha256Hex(secret).slice(0, 16),
  };
}

export function decryptAgentSecret(
  value: { ciphertext: string; iv: string; authTag: string },
  explicitKey?: string,
): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(explicitKey),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function recordsChecksum(records: unknown[]): string {
  return sha256Hex(stableJson(records));
}

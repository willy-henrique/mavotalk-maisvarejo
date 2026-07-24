import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const SESSION_HOURS = 8;
const COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-mavo_master_session"
    : "mavo_master_session";

export type MavoMasterSession = {
  scope: "mavo-master";
  email: string;
  name: string;
};

function normalized(value: string | undefined): string {
  return String(value || "").trim();
}

function getJwtSecret(): Uint8Array | null {
  const raw = normalized(process.env.MAVO_MASTER_JWT_SECRET || process.env.JWT_SECRET);
  if (!raw || (process.env.NODE_ENV === "production" && raw === "dev_secret_change_me")) {
    return null;
  }
  return new TextEncoder().encode(raw);
}

function safeEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getMavoMasterAuthStatus() {
  const email = normalized(process.env.MAVO_MASTER_EMAIL).toLowerCase();
  const hasPassword = Boolean(
    normalized(process.env.MAVO_MASTER_PASSWORD_HASH) ||
      normalized(process.env.MAVO_MASTER_PASSWORD),
  );
  return {
    configured: Boolean(email && hasPassword && getJwtSecret()),
    emailConfigured: Boolean(email),
    passwordConfigured: hasPassword,
    secretConfigured: Boolean(getJwtSecret()),
  };
}

export async function verifyMavoMasterCredentials(email: string, password: string) {
  const configuredEmail = normalized(process.env.MAVO_MASTER_EMAIL).toLowerCase();
  const configuredHash = normalized(process.env.MAVO_MASTER_PASSWORD_HASH);
  const configuredPassword = normalized(process.env.MAVO_MASTER_PASSWORD);

  if (!getMavoMasterAuthStatus().configured) return false;
  const emailMatches = safeEqual(email.trim().toLowerCase(), configuredEmail);
  const passwordMatches = configuredHash
    ? await bcrypt.compare(password, configuredHash).catch(() => false)
    : safeEqual(password, configuredPassword);
  return emailMatches && passwordMatches;
}

export async function createMavoMasterSession(email: string) {
  const secret = getJwtSecret();
  if (!secret) throw new Error("Mavo master JWT secret is not configured");

  const payload: MavoMasterSession = {
    scope: "mavo-master",
    email: email.trim().toLowerCase(),
    name: normalized(process.env.MAVO_MASTER_NAME) || "Administrador Mavo",
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer("mavo-talk")
    .setAudience("mavo-admin")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(secret);
}

export async function getMavoMasterSession(): Promise<MavoMasterSession | null> {
  const secret = getJwtSecret();
  if (!secret) return null;
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const verified = await jwtVerify<MavoMasterSession>(token, secret, {
      issuer: "mavo-talk",
      audience: "mavo-admin",
    });
    return verified.payload.scope === "mavo-master" ? verified.payload : null;
  } catch {
    return null;
  }
}

export async function setMavoMasterCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * SESSION_HOURS,
  });
}

export async function clearMavoMasterCookie() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

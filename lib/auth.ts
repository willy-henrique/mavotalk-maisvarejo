import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const issuer = "mavo-talk";
const audience = "mavo-talk-web";

function secret(): Uint8Array {
  const configured = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 32)) {
    throw new Error("JWT_SECRET forte é obrigatório em produção");
  }
  return new TextEncoder().encode(configured || "development-only-secret-change-me");
}

export function sessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME || "willtalk_session";
}

export type SessionPayload = {
  userId: string;
  organizationId: string;
  role: "admin" | "gestor" | "atendente";
  name: string;
  email: string;
};

export async function signSession(payload: SessionPayload) {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const result = await jwtVerify<SessionPayload>(token, secret(), {
      issuer,
      audience,
      algorithms: ["HS256"],
    });
    return result.payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;

  if (!token) return null;
  return verifySessionToken(token);
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  const configuredSameSite = process.env.SESSION_COOKIE_SAME_SITE;
  const sameSite =
    configuredSameSite === "none" || configuredSameSite === "strict"
      ? configuredSameSite
      : "lax";
  store.set(sessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(sessionCookieName());
}


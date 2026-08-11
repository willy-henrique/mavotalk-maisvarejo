import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";

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

/**
 * Sessão do pedido atual.
 *
 * O cookie continua sendo o caminho preferencial, mas painel e API ficam em
 * subdomínios distintos de onrender.com — que está na Public Suffix List, então o
 * navegador os trata como sites diferentes e o cookie de sessão é third-party.
 * Safari no iPhone bloqueia esses cookies por padrão: o login respondia 200, o
 * cookie era descartado e todo pedido seguinte voltava 401. O cabeçalho
 * Authorization é o caminho que não depende de cookie de terceiros.
 */
export async function getSession() {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value ?? (await bearerToken());

  if (!token) return null;
  return verifySessionToken(token);
}

async function bearerToken(): Promise<string | null> {
  const header = (await headers()).get("authorization");
  if (!header) return null;
  const [scheme, value] = header.split(" ");
  if (!value || scheme.toLowerCase() !== "bearer") return null;
  return value.trim() || null;
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


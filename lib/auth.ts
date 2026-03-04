import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const secret = new TextEncoder().encode(process.env.JWT_SECRET || "dev_secret_change_me");
const cookieName = "willtalk_session";

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
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(secret);
}

export async function getSession() {
  const store = await cookies();
  const token = store.get(cookieName)?.value;

  if (!token) return null;

  try {
    const result = await jwtVerify<SessionPayload>(token, secret);
    return result.payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const store = await cookies();
  store.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(cookieName);
}


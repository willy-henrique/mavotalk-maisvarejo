import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createMavoMasterSession,
  getMavoMasterAuthStatus,
  setMavoMasterCookie,
  verifyMavoMasterCredentials,
} from "@/lib/mavo-master-auth";
import { logger } from "@/lib/logger";

const loginSchema = z.object({
  email: z.string().email().max(180),
  password: z.string().min(8).max(200),
});

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, { count: number; resetAt: number }>();

function requestIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  if (!getMavoMasterAuthStatus().configured) {
    return NextResponse.json(
      { error: "Acesso master ainda não foi configurado no ambiente." },
      { status: 503 },
    );
  }

  const ip = requestIp(request);
  const now = Date.now();
  const current = attempts.get(ip);
  if (current && current.resetAt > now && current.count >= MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: "Muitas tentativas. Aguarde alguns minutos e tente novamente." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((current.resetAt - now) / 1000)) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Informe e-mail e senha válidos." }, { status: 400 });
  }

  const valid = await verifyMavoMasterCredentials(parsed.data.email, parsed.data.password);
  if (!valid) {
    const active = current && current.resetAt > now
      ? { count: current.count + 1, resetAt: current.resetAt }
      : { count: 1, resetAt: now + WINDOW_MS };
    attempts.set(ip, active);
    logger.warn({ ip, attempt: active.count }, "Mavo master login rejected");
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
  }

  attempts.delete(ip);
  const token = await createMavoMasterSession(parsed.data.email);
  await setMavoMasterCookie(token);
  logger.info({ email: parsed.data.email.trim().toLowerCase() }, "Mavo master login accepted");
  return NextResponse.json({ ok: true });
}

import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { metricsError } from "@/lib/metrics/envelope";
import { metricsServiceTokenIsValid } from "@/lib/metrics/guard";
import { consumirTokenRecuperacao } from "@/lib/metrics/password-reset";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

const entradaSchema = z.object({
  token: z.string().min(40).max(512).regex(/^[A-Za-z0-9_-]+$/),
  password: z.string().min(10).max(128),
});

function origemDaRequisicao(request: Request): string {
  return (request.headers.get("x-forwarded-for") || "desconhecido")
    .split(",")[0]
    .trim()
    .slice(0, 100);
}

export async function POST(request: Request) {
  if (!metricsServiceTokenIsValid(request.headers.get("x-mavo-service-token"))) {
    return metricsError("unauthenticated", "Origem não autorizada");
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return metricsError("invalid_request", "Link inválido ou expirado");
  }
  const analisado = entradaSchema.safeParse(corpo);
  if (!analisado.success) {
    return metricsError("invalid_request", "Link inválido ou expirado, ou senha fora da política");
  }

  const [limiteOrigem, limiteToken] = await Promise.all([
    consumeRateLimit(
      "metrics-password-reset-ip",
      rateLimitSubject(origemDaRequisicao(request)),
      12,
      15 * 60,
    ),
    consumeRateLimit(
      "metrics-password-reset-token",
      rateLimitSubject(analisado.data.token),
      6,
      15 * 60,
    ),
  ]);
  if (!limiteOrigem.allowed || !limiteToken.allowed) {
    return metricsError("rate_limited", "Muitas tentativas. Aguarde alguns minutos.");
  }

  try {
    const senhaProtegida = await bcrypt.hash(analisado.data.password, 12);
    const alterada = await consumirTokenRecuperacao(analisado.data.token, senhaProtegida);
    if (!alterada) return metricsError("invalid_request", "Link inválido ou expirado");
    return NextResponse.json({ data: { reset: true } });
  } catch {
    return metricsError("internal", "Não foi possível redefinir a senha agora");
  }
}

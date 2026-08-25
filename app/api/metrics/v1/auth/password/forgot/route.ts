import { NextResponse } from "next/server";
import { z } from "zod";
import { metricsError } from "@/lib/metrics/envelope";
import { metricsServiceTokenIsValid } from "@/lib/metrics/guard";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";
import { getUserByEmail } from "@/lib/repo";
import {
  criarTokenRecuperacao,
  telefoneParaRecuperacao,
} from "@/lib/metrics/password-reset";
import { entregarRecuperacaoPorWhatsApp } from "@/lib/metrics/password-reset-delivery";
import { logger } from "@/lib/logger";
import { sanitizedError } from "@/lib/observability";

export const dynamic = "force-dynamic";

const RESPOSTA_ACEITA = {
  data: {
    accepted: true,
    message: "Se a conta estiver habilitada, enviaremos as instruções pelo WhatsApp.",
  },
};

const entradaSchema = z.object({
  email: z.string().trim().email().max(254),
});

function respostaAceita() {
  return NextResponse.json(RESPOSTA_ACEITA, { status: 202 });
}

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
    return metricsError("invalid_request", "Informe um e-mail válido");
  }
  const analisado = entradaSchema.safeParse(corpo);
  if (!analisado.success) return metricsError("invalid_request", "Informe um e-mail válido");

  const email = analisado.data.email.toLowerCase();
  const origem = origemDaRequisicao(request);
  const [limiteOrigem, limiteIdentidade] = await Promise.all([
    consumeRateLimit("metrics-password-forgot-ip", rateLimitSubject(origem), 8, 15 * 60),
    consumeRateLimit("metrics-password-forgot-email", rateLimitSubject(email), 3, 15 * 60),
  ]);
  if (!limiteOrigem.allowed || !limiteIdentidade.allowed) {
    return metricsError("rate_limited", "Muitas tentativas. Aguarde alguns minutos.");
  }

  try {
    const usuario = await getUserByEmail(email);
    if (
      !usuario
      || usuario.isActive === false
      || (usuario.role !== "admin" && usuario.role !== "gestor")
    ) {
      return respostaAceita();
    }

    const telefone = await telefoneParaRecuperacao(usuario.organizationId, usuario.id);
    if (!telefone) return respostaAceita();

    const recuperacao = await criarTokenRecuperacao(usuario.organizationId, usuario.id);
    await entregarRecuperacaoPorWhatsApp(telefone, recuperacao.token);
  } catch (falha) {
    logger.warn(
      { error: sanitizedError(falha) },
      "Solicitação de recuperação não pôde ser concluída",
    );
  }

  return respostaAceita();
}

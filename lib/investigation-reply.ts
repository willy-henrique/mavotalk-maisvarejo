import { analyzeImageForSupport } from "@/lib/image-vision";

/** Rodadas de resposta da IA após o pedido de evidências (antes do handoff humano). */
export const INVESTIGATION_AI_ROUNDS = 2;

export function buildQuickGuidance(inputText: string): string | null {
  const t = String(inputText || "").toLowerCase();
  if (
    t.includes("banco de dados") ||
    t.includes("conexao com o banco") ||
    t.includes("conectar no banco") ||
    t.includes("postgres")
  ) {
    return (
      "Antes do tecnico assumir, tente estes passos rapidos: " +
      "1) confirme se o servidor/servico do banco esta ativo, " +
      "2) valide host, porta, usuario, senha e nome do banco na configuracao, " +
      "3) teste acesso pelo cliente SQL (ex.: pgAdmin), " +
      "4) verifique firewall/VPN/rede e reinicie a aplicacao apos ajuste."
    );
  }
  if (t.includes("fiscal") || t.includes("nota") || t.includes("sefaz")) {
    return (
      "Como teste rapido: valide internet e data/hora do servidor, confira certificado digital e tente emitir novamente " +
      "com o erro completo na tela para acelerar o diagnostico."
    );
  }
  return null;
}

export async function buildInvestigationAiReply(params: {
  roundIndex: number;
  body: string;
  mediaUrl: string | null;
  mimeType: string | null;
  queueName: string;
}): Promise<string> {
  const { roundIndex, body, mediaUrl, mimeType, queueName } = params;
  const text = String(body || "").trim();

  if (roundIndex === 0) {
    if (mediaUrl && mimeType?.startsWith("image/")) {
      const vision = await analyzeImageForSupport({
        mediaUrl,
        mimeType,
        inboundBody: text || "[imagem]",
      });
      if (vision) {
        return `${vision}\n\n_Se ainda não resolver, responda com o próximo sintoma ou erro._`;
      }
    }
    const quick = buildQuickGuidance(text);
    if (quick) return `${quick}\n\n_Se puder, envie também um print da tela._`;
    return `Recebi sua mensagem sobre *${queueName}*. Para avançar com precisão, envie um print da tela e a mensagem de erro exata (se houver).`;
  }

  const quick = buildQuickGuidance(text);
  if (quick) {
    return `${quick}\n\n_Se o problema continuar, na próxima mensagem encaminho ao técnico._`;
  }
  return (
    `Obrigado pelas informações sobre *${queueName}*. Se ainda precisar de ajuda, descreva o que já tentou. ` +
    `Na próxima mensagem, encaminho ao técnico se necessário.`
  );
}

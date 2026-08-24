import type { ConversationStatus } from "@/lib/repo-types";

/**
 * Uma mensagem do cliente pode abrir/reabrir a fila, mas nunca retirar um chamado
 * de uma pessoa que já o assumiu.
 */
export function statusAfterInboundMessage(
  currentStatus: ConversationStatus,
): ConversationStatus {
  return currentStatus === "em_atendimento" ? "em_atendimento" : "aguardando";
}

export type OutboundEchoTarget =
  | { action: "attach"; conversationId: string }
  | { action: "open" }
  | { action: "skip"; reason: "bot_message_without_conversation" };

/**
 * Onde persistir uma mensagem enviada pelo próprio número e devolvida pelo
 * WhatsApp como `fromMe`.
 *
 * A distinção que importa é quem escreveu. Uma pessoa falando pelo aparelho está
 * iniciando ou continuando um atendimento, e isso merece protocolo. O sistema
 * enviando o aviso de encerramento ou o agradecimento pela avaliação está
 * *fechando* um atendimento — a última coisa que essa mensagem pode fazer é
 * abrir outro.
 *
 * Sem esta regra, o eco da despedida não encontrava conversa aberta (o chamado
 * acabara de ser encerrado), caía no caminho de criação e nascia uma conversa em
 * `aguardando` só para hospedá-la. Para o operador, isso aparecia como chamado
 * fantasma na Caixa de entrada logo após finalizar o atendimento.
 */
export function resolveOutboundEchoTarget(input: {
  fromBot: boolean;
  latestConversation: { id: string; status: ConversationStatus } | null;
}): OutboundEchoTarget {
  if (!input.fromBot) return { action: "open" };

  // Anexa à última conversa do contato qualquer que seja o status: a despedida
  // pertence ao histórico do atendimento que a gerou, encerrado inclusive.
  if (input.latestConversation) {
    return { action: "attach", conversationId: input.latestConversation.id };
  }

  // Bot falando com quem não tem conversa nenhuma não tem onde anexar, e abrir
  // um chamado seria registrar uma demanda que o cliente não fez.
  return { action: "skip", reason: "bot_message_without_conversation" };
}

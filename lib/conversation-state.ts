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

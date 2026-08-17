import { isDirectUserJid } from "@/lib/whatsapp-addressing";

type HistoryMessageKey = {
  id?: string | null;
  remoteJid?: string | null;
};

export type WhatsappHistoryMessage = {
  key?: HistoryMessageKey | null;
  message?: unknown;
  messageTimestamp?: unknown;
  broadcast?: boolean | null;
};

export function whatsappMessageTimestampSeconds(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "bigint") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    const toNumber = (value as { toNumber?: unknown }).toNumber;
    if (typeof toNumber === "function") {
      const parsed = Number(toNumber.call(value));
      return Number.isFinite(parsed) ? parsed : 0;
    }
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Seleciona somente o trecho recente e seguro do histórico entregue pelo Baileys.
 *
 * O WhatsApp pode enviar milhares de mensagens no primeiro pareamento. Importar o
 * lote inteiro bloquearia a instância gratuita do Render e abriria chamados muito
 * antigos. Mantemos as mais novas dentro da janela configurada e devolvemos em
 * ordem cronológica para preservar a sequência da conversa.
 */
export function selectRecentWhatsappHistoryMessages<T extends WhatsappHistoryMessage>(
  messages: T[],
  options: {
    nowSeconds: number;
    maxAgeSeconds: number;
    maxMessages: number;
  },
): T[] {
  const maxMessages = Math.max(0, Math.floor(options.maxMessages));
  if (!maxMessages) return [];

  const oldestAllowed = options.nowSeconds - Math.max(0, options.maxAgeSeconds);
  const newestAllowed = options.nowSeconds + 5 * 60;
  const seenIds = new Set<string>();

  const eligible = messages.filter((message) => {
    const id = String(message.key?.id || "").trim();
    const jid = String(message.key?.remoteJid || "").trim();
    const timestamp = whatsappMessageTimestampSeconds(message.messageTimestamp);
    if (
      !id ||
      seenIds.has(id) ||
      !message.message ||
      message.broadcast ||
      !isDirectUserJid(jid) ||
      timestamp < oldestAllowed ||
      timestamp > newestAllowed
    ) {
      return false;
    }
    seenIds.add(id);
    return true;
  });

  return eligible
    .sort(
      (left, right) =>
        whatsappMessageTimestampSeconds(right.messageTimestamp) -
        whatsappMessageTimestampSeconds(left.messageTimestamp),
    )
    .slice(0, maxMessages)
    .sort(
      (left, right) =>
        whatsappMessageTimestampSeconds(left.messageTimestamp) -
        whatsappMessageTimestampSeconds(right.messageTimestamp),
    );
}

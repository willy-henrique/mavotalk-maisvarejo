import type { AnyMessageContent } from "@whiskeysockets/baileys";

/**
 * Como cada mídia vira mensagem no WhatsApp.
 *
 * Vive fora do `whatsapp-client` porque é decisão de produto, não de transporte:
 * "áudio gravado pelo atendente chega como nota de voz, não como arquivo" é uma
 * regra que precisa ser afirmada em teste. Enterrada no meio do cliente do
 * Baileys, ela só dava para conferir lendo o código.
 *
 * O tipo do Baileys entra como `import type`: some na compilação, então quem
 * testa este módulo não carrega o cliente do WhatsApp junto.
 */

type MediaOptions = {
  mimeType?: string;
  fileName?: string;
  /** Duração em segundos, quando o remetente já sabe. Ver nota em `ptt`. */
  seconds?: number;
};

const DOCUMENT_MIME_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
};

export function buildOutboundMediaContent(
  mediaUrl: string,
  caption?: string,
  options?: MediaOptions,
): AnyMessageContent {
  const clean = mediaUrl.split("?")[0].toLowerCase();
  const declaredMimeType = String(options?.mimeType || "").toLowerCase();

  if (declaredMimeType.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(clean)) {
    return { image: { url: mediaUrl }, caption: caption || undefined };
  }

  if (declaredMimeType.startsWith("video/") || /\.(mp4|3gp|mov)$/.test(clean)) {
    return { video: { url: mediaUrl }, caption: caption || undefined };
  }

  if (declaredMimeType.startsWith("audio/") || /\.(mp3|ogg|oga|m4a|wav|opus)$/.test(clean)) {
    // `ptt: true` é o que faz o WhatsApp mostrar a bolinha de play com a onda.
    // Sem isso o áudio chega como arquivo anexado, que o cliente precisa baixar
    // para ouvir — e um atendimento por voz que exige download não é atendimento
    // por voz. O Baileys calcula a duração sozinho quando `seconds` não vem, e
    // a onda é opcional: falha na geração é registrada e não impede o envio.
    return {
      audio: { url: mediaUrl },
      mimetype: declaredMimeType || "audio/ogg",
      ptt: true,
      ...(options?.seconds ? { seconds: Math.round(options.seconds) } : {}),
    };
  }

  const fileName = options?.fileName || mediaUrl.split("/").pop() || "arquivo";
  const extMatch = /\.([a-z0-9]+)$/.exec(clean);
  const mimetype =
    declaredMimeType ||
    (extMatch && DOCUMENT_MIME_TYPES[extMatch[1]]) ||
    "application/octet-stream";

  return { document: { url: mediaUrl }, mimetype, fileName, caption: caption || undefined };
}

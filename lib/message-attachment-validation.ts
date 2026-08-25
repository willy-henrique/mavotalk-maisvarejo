export const MAX_MESSAGE_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Só Ogg/Opus.
 *
 * O WhatsApp reproduz nota de voz em ogg/opus; webm, que é o que o Chrome grava
 * nativamente, chega quebrado no celular do cliente. Aceitar aqui um formato que
 * o destino não toca seria empurrar a falha para o fim da linha, onde ninguém
 * consegue diagnosticar.
 */
const ALLOWED_AUDIO_TYPES = new Set(["audio/ogg", "audio/opus"]);

export type MessageAttachmentKind = "image" | "document" | "audio";

export type ValidMessageAttachment = {
  kind: MessageAttachmentKind;
  mimeType: string;
  fileName: string;
  placeholder: "[imagem]" | "[documento]" | "[audio]";
};

/**
 * Onde cada anexo vive no Cloudinary.
 *
 * Áudio sobe como `video` — é o tipo de recurso que o Cloudinary usa para tudo
 * que tem linha do tempo. Limpar um áudio órfão como `image` não apagaria nada,
 * e o recurso ficaria pago e esquecido, em silêncio.
 */
export function cloudinaryResourceTypeForAttachment(
  kind: MessageAttachmentKind,
): "image" | "raw" | "video" {
  if (kind === "document") return "raw";
  if (kind === "audio") return "video";
  return "image";
}

/** "audio/ogg; codecs=opus" e "audio/ogg" são o mesmo container. */
function baseMimeType(value: string): string {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function hasOggSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x4f &&
    bytes[1] === 0x67 &&
    bytes[2] === 0x67 &&
    bytes[3] === 0x53
  );
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

export function sanitizeAttachmentFileName(name: string, fallback: string): string {
  const clean = String(name || "")
    .normalize("NFKC")
    .replace(/[\\/\0-\x1f\x7f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return clean || fallback;
}

export function validateMessageAttachment(
  file: Pick<File, "name" | "size" | "type">,
  bytes: Uint8Array,
): ValidMessageAttachment {
  if (file.size <= 0 || file.size > MAX_MESSAGE_ATTACHMENT_BYTES) {
    throw new Error("O anexo deve ter no máximo 16 MB.");
  }

  if (ALLOWED_IMAGE_TYPES.has(file.type)) {
    return {
      kind: "image",
      mimeType: file.type,
      fileName: sanitizeAttachmentFileName(file.name, "imagem"),
      placeholder: "[imagem]",
    };
  }

  const audioType = baseMimeType(file.type);
  if (ALLOWED_AUDIO_TYPES.has(audioType)) {
    if (!hasOggSignature(bytes)) {
      throw new Error("O arquivo enviado não é um áudio válido.");
    }
    const baseName = sanitizeAttachmentFileName(file.name, "audio.ogg");
    return {
      kind: "audio",
      // Normalizado: o que vai para o WhatsApp e para o Cloudinary não deve
      // depender de qual navegador gravou.
      mimeType: "audio/ogg",
      fileName: /\.ogg$/i.test(baseName) ? baseName : `${baseName}.ogg`,
      placeholder: "[audio]",
    };
  }

  const looksLikePdf = hasPdfSignature(bytes);
  const declaredAsPdf =
    file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (looksLikePdf && declaredAsPdf) {
    const baseName = sanitizeAttachmentFileName(file.name, "documento.pdf");
    return {
      kind: "document",
      mimeType: "application/pdf",
      fileName: /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`,
      placeholder: "[documento]",
    };
  }

  if (declaredAsPdf && !looksLikePdf) {
    throw new Error("O arquivo selecionado não é um PDF válido.");
  }

  throw new Error("Envie uma imagem JPEG, PNG, WebP ou GIF, ou um arquivo PDF.");
}

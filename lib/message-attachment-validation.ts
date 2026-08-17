export const MAX_MESSAGE_ATTACHMENT_BYTES = 16 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type ValidMessageAttachment = {
  kind: "image" | "document";
  mimeType: string;
  fileName: string;
  placeholder: "[imagem]" | "[documento]";
};

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

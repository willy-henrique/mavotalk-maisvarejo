export const MAX_PROMOTION_IMAGE_BYTES = Number(process.env.PROMOTION_IMAGE_MAX_BYTES || 8 * 1024 * 1024);
const MIME_BY_SIGNATURE: Array<{ mimeType: "image/jpeg" | "image/png" | "image/webp"; matches: (bytes: Uint8Array) => boolean }> = [
  { mimeType: "image/jpeg", matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mimeType: "image/png", matches: (b) => b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => b[index] === value) },
  { mimeType: "image/webp", matches: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
];

/** Valida bytes reais; `file.type` é apenas uma indicação enviada pelo navegador. */
export function validatePromotionImage(file: File, bytes: Uint8Array): { mimeType: "image/jpeg" | "image/png" | "image/webp" } {
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_PROMOTION_IMAGE_BYTES) throw new Error(`A imagem deve ter até ${Math.floor(MAX_PROMOTION_IMAGE_BYTES / 1024 / 1024)} MB.`);
  const detected = MIME_BY_SIGNATURE.find((candidate) => candidate.matches(bytes));
  if (!detected) throw new Error("Envie uma imagem JPG, JPEG, PNG ou WEBP válida.");
  return { mimeType: detected.mimeType };
}

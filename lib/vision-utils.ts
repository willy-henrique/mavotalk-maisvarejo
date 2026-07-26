export function isLikelyImagePayload(
  mediaUrl: string | null | undefined,
  mimeType: string | null | undefined,
): boolean {
  if (mimeType?.startsWith("image/")) return true;
  if (!mediaUrl) return false;
  const u = mediaUrl.toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i.test(u)) return true;
  if (u.includes("cloudinary.com") && u.includes("/image/upload/")) return true;
  if (u.includes("/image/") && (u.includes("upload") || u.includes("raw"))) return true;
  return false;
}

import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "node:crypto";

const cleanEnv = (value: string | undefined) => String(value || "").trim().replace(/^(['"])(.*)\1$/, "$2");
/** Descarta os placeholders `<your_api_key>` copiados do painel do Cloudinary. */
const usable = (value: string) => (value && !/^<.*>$/.test(value) ? value : "");
function fromCloudinaryUrl(value: string) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "cloudinary:") return null;
    const parsed = { cloudName: usable(decodeURIComponent(url.hostname)), apiKey: usable(decodeURIComponent(url.username)), apiSecret: usable(decodeURIComponent(url.password)) };
    return parsed.cloudName && parsed.apiKey && parsed.apiSecret ? parsed : null;
  } catch {
    return null;
  }
}
/**
 * As variáveis explícitas vencem a CLOUDINARY_URL: são elas que se edita no painel do Render,
 * e uma URL antiga esquecida no ambiente tornava a correção invisível. A URL só entra inteira,
 * como fallback, para nunca combinar credenciais de contas diferentes.
 */
export function resolveCloudinaryConfig(env: Record<string, string | undefined> = process.env) {
  const explicit = {
    cloudName: usable(cleanEnv(env.CLOUDINARY_CLOUD_NAME)),
    apiKey: usable(cleanEnv(env.CLOUDINARY_API_KEY)),
    apiSecret: usable(cleanEnv(env.CLOUDINARY_API_SECRET)),
  };
  if (explicit.cloudName && explicit.apiKey && explicit.apiSecret) return { ...explicit, source: "env" as const };
  const urlConfig = fromCloudinaryUrl(cleanEnv(env.CLOUDINARY_URL));
  if (urlConfig) return { ...urlConfig, source: "url" as const };
  return { ...explicit, source: "none" as const };
}

const { cloudName, apiKey, apiSecret, source } = resolveCloudinaryConfig();

/** Identificação da conta em uso, sem segredo, para os logs de falha de upload. */
export const cloudinaryConfigSummary = () => ({ cloudName: cloudName || "unset", apiKeyTail: apiKey ? apiKey.slice(-4) : "unset", source });

function cloudinaryError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string") return new Error(error);
  if (error && typeof error === "object") {
    const value = error as { message?: unknown; error?: { message?: unknown }; http_code?: unknown };
    const message = value.message || value.error?.message;
    if (message) return new Error(`Cloudinary (${value.http_code || "upload"}): ${String(message)}`);
    try { return new Error(`Cloudinary upload failed: ${JSON.stringify(error)}`); } catch { /* fallback below */ }
  }
  return new Error("Cloudinary upload failed");
}

if (cloudName && apiKey && apiSecret) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

export async function uploadTwilioMediaToCloudinary(mediaUrl: string, mimeType?: string | null) {
  if (!cloudName || !apiKey || !apiSecret) return null;

  const headers: Record<string, string> = {};
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }

  const response = await fetch(mediaUrl, { headers });
  if (!response.ok) {
    throw new Error(`Falha ao baixar midia Twilio (${response.status})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  return await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "willtalk/messages",
        resource_type: "auto",
        format: mimeType?.startsWith("image/") ? undefined : "pdf",
      },
      (error, result) => {
        if (error || !result) {
          reject(error ? cloudinaryError(error) : new Error("Upload cloudinary sem resultado"));
          return;
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );

    stream.end(buffer);
  });
}

export async function uploadBase64ToCloudinary(base64Data: string, mimeType?: string | null, folder = "willtalk/messages") {
  if (!cloudName || !apiKey || !apiSecret) return null;

  return uploadBufferToCloudinary(Buffer.from(base64Data, "base64"), mimeType, folder);
}

export async function uploadBufferToCloudinary(buffer: Buffer, mimeType?: string | null, folder = "willtalk/messages") {
  if (!cloudName || !apiKey || !apiSecret) return null;
  const resourceType = mimeType?.startsWith("image/")
    ? "image"
    : mimeType?.startsWith("audio/")
      ? "video"
      : "raw";
  const publicId =
    resourceType === "raw" && mimeType === "application/pdf"
      ? `${randomUUID()}.pdf`
      : undefined;

  return new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: resourceType,
        ...(publicId ? { public_id: publicId } : {}),
      },
      (error, result) => {
        if (error || !result) {
          reject(error ? cloudinaryError(error) : new Error("Upload cloudinary sem resultado"));
          return;
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );
    stream.end(buffer);
  });
}

/** Gera URL assinada (validação de acesso). */
export function generateSignedUrl(publicId: string): string {
  if (!cloudName || !apiKey || !apiSecret) return "";
  return cloudinary.url(publicId, { sign_url: true, secure: true });
}

/** Remove recursos do Cloudinary. */
export async function deleteCloudinaryResources(
  publicIds: string[],
  resourceType: "image" | "video" | "raw" = "image",
): Promise<void> {
  if (!cloudName || !apiKey || !apiSecret || publicIds.length === 0) return;
  await cloudinary.api.delete_resources(publicIds, { resource_type: resourceType });
}

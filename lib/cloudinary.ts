import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

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
          reject(error || new Error("Upload cloudinary sem resultado"));
          return;
        }
        resolve({ secure_url: result.secure_url, public_id: result.public_id });
      },
    );

    stream.end(buffer);
  });
}

export async function uploadBase64ToCloudinary(base64Data: string, mimeType?: string | null) {
  if (!cloudName || !apiKey || !apiSecret) return null;

  const dataUri = `data:${mimeType || "application/octet-stream"};base64,${base64Data}`;
  const resourceType = mimeType?.startsWith("image/")
    ? "image"
    : mimeType?.startsWith("audio/")
      ? "video"
      : "raw";

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "willtalk/messages",
    resource_type: resourceType,
  });

  return { secure_url: result.secure_url, public_id: result.public_id };
}

/** Gera URL assinada (validação de acesso). */
export function generateSignedUrl(publicId: string): string {
  if (!cloudName || !apiKey || !apiSecret) return "";
  return cloudinary.url(publicId, { sign_url: true, secure: true });
}

/** Remove recursos do Cloudinary. */
export async function deleteCloudinaryResources(publicIds: string[]): Promise<void> {
  if (!cloudName || !apiKey || !apiSecret || publicIds.length === 0) return;
  await cloudinary.api.delete_resources(publicIds, { resource_type: "image" });
}

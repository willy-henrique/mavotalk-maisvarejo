import { NextResponse } from "next/server";
import { requireSupermarketAdmin } from "@/lib/supermarket-admin-auth";
import { createAuditLog } from "@/lib/repo";
import { deleteCloudinaryResources, uploadBase64ToCloudinary } from "@/lib/cloudinary";
import { getSupermarketSettings, updateSupermarketSettings } from "@/lib/supermarket-settings";

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const auth = await requireSupermarketAdmin(request);
  if (auth.error || !auth.session) return auth.error;
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || !ALLOWED.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Envie uma imagem JPEG, PNG ou WebP de até 8 MB." }, { status: 400 });
  }
  const current = await getSupermarketSettings(auth.session.organizationId);
  const upload = await uploadBase64ToCloudinary(Buffer.from(await file.arrayBuffer()).toString("base64"), file.type, "willtalk/offers");
  if (!upload) return NextResponse.json({ error: "Cloudinary não está configurado no servidor." }, { status: 503 });
  const settings = await updateSupermarketSettings(auth.session.organizationId, {
    offersImageUrl: upload.secure_url,
    offersImagePublicId: upload.public_id,
  });
  if (current.offersImagePublicId) await deleteCloudinaryResources([current.offersImagePublicId]).catch(() => undefined);
  await createAuditLog(auth.session.organizationId, auth.session.userId, "upload_supermarket_offer_image", "organization", auth.session.organizationId, {
    publicId: upload.public_id,
    origin: auth.session.userId ? "operational-admin" : "mavo-master",
  });
  return NextResponse.json({ settings });
}

export async function DELETE(request: Request) {
  const auth = await requireSupermarketAdmin(request);
  if (auth.error || !auth.session) return auth.error;
  const current = await getSupermarketSettings(auth.session.organizationId);
  if (current.offersImagePublicId) await deleteCloudinaryResources([current.offersImagePublicId]).catch(() => undefined);
  const settings = await updateSupermarketSettings(auth.session.organizationId, { offersImageUrl: null, offersImagePublicId: null });
  await createAuditLog(auth.session.organizationId, auth.session.userId, "remove_supermarket_offer_image", "organization", auth.session.organizationId, {
    origin: auth.session.userId ? "operational-admin" : "mavo-master",
  });
  return NextResponse.json({ settings });
}

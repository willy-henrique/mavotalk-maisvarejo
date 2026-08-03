import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { uploadBase64ToCloudinary } from "@/lib/cloudinary";
import { validatePromotionImage } from "@/lib/image-upload-validation";
import { logger } from "@/lib/logger";
import { createQueuePromotion, listQueuePromotions } from "@/lib/queue-automation";
import { promotionInputSchema } from "@/lib/queue-automation-schemas";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "read"); if (denied) return denied;
  const { id } = await context.params; return NextResponse.json({ promotions: await listQueuePromotions(auth.session.organizationId, id) });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "create"); if (denied) return denied;
  const form = await request.formData().catch(() => null); if (!form) return NextResponse.json({ error: "Formulário inválido." }, { status: 400 });
  const raw = form.get("data"); const file = form.get("file");
  if (typeof raw !== "string" || !(file instanceof File)) return NextResponse.json({ error: "Envie os dados e o flyer da promoção." }, { status: 400 });
  let data: unknown; try { data = JSON.parse(raw); } catch { return NextResponse.json({ error: "Dados da promoção inválidos." }, { status: 400 }); }
  const parsed = promotionInputSchema.safeParse(data); if (!parsed.success) return NextResponse.json({ error: "Dados da promoção inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  let image: { mimeType: "image/jpeg" | "image/png" | "image/webp" }; try { image = validatePromotionImage(file, bytes); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Flyer inválido." }, { status: 422 }); }
  const { id } = await context.params;
  let upload: Awaited<ReturnType<typeof uploadBase64ToCloudinary>>;
  try {
    upload = await uploadBase64ToCloudinary(Buffer.from(bytes).toString("base64"), image.mimeType, `willtalk/${auth.session.organizationId}/queues/${id}/promotions`);
  } catch (error) {
    logger.error({
      organizationId: auth.session.organizationId,
      queueId: id,
      errorCode: error instanceof Error ? error.name : "CLOUDINARY_UPLOAD_FAILED",
    }, "queue_promotion_image_upload_failed");
    return NextResponse.json({ error: "Não foi possível enviar o flyer. Verifique a configuração do armazenamento de imagens e tente novamente." }, { status: 502 });
  }
  if (!upload) return NextResponse.json({ error: "Armazenamento de imagens indisponível." }, { status: 503 });
  try {
    const promotion = await createQueuePromotion(auth.session.organizationId, id, auth.session.userId, parsed.data, { url: upload.secure_url, publicId: upload.public_id, mimeType: image.mimeType, bytes: file.size });
    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível criar a promoção." }, { status: 422 });
  }
}

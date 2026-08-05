import { NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { cloudinaryConfigSummary, uploadBufferToCloudinary } from "@/lib/cloudinary";
import { validatePromotionImage } from "@/lib/image-upload-validation";
import { logger } from "@/lib/logger";
import { createQueuePromotion, listQueuePromotions } from "@/lib/queue-automation";
import { promotionInputSchema } from "@/lib/queue-automation-schemas";

/** Teto por promoção: o WhatsApp entrega uma imagem por mensagem, e uma rajada longa parece spam. */
const MAX_FLYERS_PER_PROMOTION = 10;

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "read"); if (denied) return denied;
  const { id } = await context.params; return NextResponse.json({ promotions: await listQueuePromotions(auth.session.organizationId, id) });
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(); if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "admin_types", "create"); if (denied) return denied;
  const form = await request.formData().catch(() => null); if (!form) return NextResponse.json({ error: "Formulário inválido." }, { status: 400 });
  const raw = form.get("data");
  // Uma promoção aceita vários flyers; a ordem enviada vira a ordem de envio ao cliente.
  const files = form.getAll("file").filter((item): item is File => item instanceof File);
  if (typeof raw !== "string" || !files.length) return NextResponse.json({ error: "Envie os dados e o flyer da promoção." }, { status: 400 });
  if (files.length > MAX_FLYERS_PER_PROMOTION) return NextResponse.json({ error: `Envie no máximo ${MAX_FLYERS_PER_PROMOTION} flyers por promoção.` }, { status: 422 });
  let data: unknown; try { data = JSON.parse(raw); } catch { return NextResponse.json({ error: "Dados da promoção inválidos." }, { status: 400 }); }
  const parsed = promotionInputSchema.safeParse(data); if (!parsed.success) return NextResponse.json({ error: "Dados da promoção inválidos.", details: parsed.error.flatten() }, { status: 422 });
  const prepared: Array<{ bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp"; size: number }> = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try { prepared.push({ bytes, mimeType: validatePromotionImage(file, bytes).mimeType, size: file.size }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Flyer inválido." }, { status: 422 }); }
  }
  const { id } = await context.params;
  let uploads: Array<{ url: string; publicId: string; mimeType: string; bytes: number }>;
  try {
    uploads = [];
    for (const item of prepared) {
      const result = await uploadBufferToCloudinary(Buffer.from(item.bytes), item.mimeType, `willtalk/${auth.session.organizationId}/queues/${id}/promotions`);
      if (!result) return NextResponse.json({ error: "Armazenamento de imagens indisponível." }, { status: 503 });
      uploads.push({ url: result.secure_url, publicId: result.public_id, mimeType: item.mimeType, bytes: item.size });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown_error";
    const credentialsRejected = /\((?:401|403)\)/.test(errorMessage) || /invalid (?:api key|signature)/i.test(errorMessage);
    logger.error({
      organizationId: auth.session.organizationId,
      queueId: id,
      errorCode: error instanceof Error ? error.name : "CLOUDINARY_UPLOAD_FAILED",
      errorMessage: errorMessage.slice(0, 240),
      cloudinary: cloudinaryConfigSummary(),
    }, "queue_promotion_image_upload_failed");
    return NextResponse.json({ error: credentialsRejected ? "As credenciais do Cloudinary foram rejeitadas. Atualize CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY e CLOUDINARY_API_SECRET no ambiente da API e faça um novo deploy." : "Não foi possível enviar o flyer. Verifique a configuração do armazenamento de imagens e tente novamente." }, { status: credentialsRejected ? 503 : 502 });
  }
  try {
    const promotion = await createQueuePromotion(auth.session.organizationId, id, auth.session.userId, parsed.data, uploads);
    return NextResponse.json({ promotion }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível criar a promoção." }, { status: 422 });
  }
}

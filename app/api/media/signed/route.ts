import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { cloudinaryResourceTypeFromUrl, signedDeliveryUrl } from "@/lib/cloudinary";
import { getCloudinaryAssetsForConversation } from "@/lib/repo";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const publicId = request.nextUrl.searchParams.get("publicId");
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!publicId || !conversationId || publicId.length > 256 || conversationId.length > 128) {
    return NextResponse.json(
      { error: "publicId e conversationId sao obrigatorios" },
      { status: 400 },
    );
  }

  const assets = await getCloudinaryAssetsForConversation(
    auth.session.organizationId,
    conversationId,
  );
  const asset = assets.find((item) => item.publicId === publicId);
  if (!asset) {
    return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
  }

  // O tipo do recurso sai da URL guardada na mensagem, nunca de um parâmetro do
  // cliente: imagem e PDF antigo entram como `image`, PDF do WhatsApp como `raw`
  // e áudio como `video`. Assinar com o tipo errado devolve 404 do Cloudinary,
  // que era o que acontecia com áudio quando tudo era assinado como imagem.
  const resourceType = cloudinaryResourceTypeFromUrl(asset.mediaUrl) ?? "image";
  const signedUrl = signedDeliveryUrl(publicId, resourceType);
  if (!signedUrl) {
    return NextResponse.json({ error: "Cloudinary nao configurado" }, { status: 503 });
  }

  const response = NextResponse.redirect(signedUrl, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { generateSignedUrl } from "@/lib/cloudinary";
import { getCloudinaryPublicIdsForConversation } from "@/lib/repo";

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

  const allowedPublicIds = await getCloudinaryPublicIdsForConversation(
    auth.session.organizationId,
    conversationId,
  );
  if (!allowedPublicIds.includes(publicId)) {
    return NextResponse.json({ error: "Midia nao encontrada" }, { status: 404 });
  }

  const signedUrl = generateSignedUrl(publicId);
  if (!signedUrl) {
    return NextResponse.json({ error: "Cloudinary nao configurado" }, { status: 503 });
  }

  const response = NextResponse.redirect(signedUrl, 302);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { generateSignedUrl } from "@/lib/cloudinary";

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;

  const publicId = request.nextUrl.searchParams.get("publicId");
  if (!publicId) {
    return NextResponse.json({ error: "publicId obrigatorio" }, { status: 400 });
  }

  const signedUrl = generateSignedUrl(publicId);
  if (!signedUrl) {
    return NextResponse.json({ error: "Cloudinary nao configurado" }, { status: 503 });
  }

  return NextResponse.redirect(signedUrl, 302);
}

import { NextRequest, NextResponse } from "next/server";
import { requireMenuPermission, requireSession } from "@/lib/api";
import { getMessageMediaForConversation } from "@/lib/repo";
import {
  cloudinaryResourceTypeFromUrl,
  signedDeliveryUrl,
} from "@/lib/cloudinary";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

function isCloudinaryDeliveryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
  } catch {
    return false;
  }
}

function hasPdfHeader(bytes: Uint8Array): boolean {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString(
    "latin1",
  );
  return prefix.includes("%PDF-");
}

async function readBodyWithLimit(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array | null> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export async function GET(request: NextRequest) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const denied = await requireMenuPermission(auth.session, "inbox", "read");
  if (denied) return denied;

  const conversationId = String(
    request.nextUrl.searchParams.get("conversationId") || "",
  ).trim();
  const messageId = String(
    request.nextUrl.searchParams.get("messageId") || "",
  ).trim();
  const shouldDownload = ["1", "true"].includes(
    String(request.nextUrl.searchParams.get("download") || "").toLowerCase(),
  );
  if (
    !conversationId ||
    !messageId ||
    conversationId.length > 128 ||
    messageId.length > 128
  ) {
    return NextResponse.json(
      { error: "conversationId e messageId são obrigatórios" },
      { status: 400 },
    );
  }

  const media = await getMessageMediaForConversation(
    auth.session.organizationId,
    conversationId,
    messageId,
  );
  if (!media?.mediaUrl || media.type !== "document") {
    return NextResponse.json({ error: "PDF não encontrado" }, { status: 404 });
  }
  if (!isCloudinaryDeliveryUrl(media.mediaUrl)) {
    logger.warn(
      { organizationId: auth.session.organizationId, conversationId, messageId },
      "Blocked PDF proxy for a non-Cloudinary stored URL",
    );
    return NextResponse.json(
      { error: "Este PDF antigo não está armazenado no repositório seguro." },
      { status: 422 },
    );
  }

  // A conta recusa a entrega pública de PDF: a URL guardada na mensagem só abre
  // assinada — é o mesmo caminho que a imagem já usa em /api/media/signed e o motivo
  // de a imagem sempre abrir e o PDF não. A URL crua fica como segunda tentativa,
  // para mensagens antigas que ficaram sem public_id.
  const resourceType = cloudinaryResourceTypeFromUrl(media.mediaUrl) ?? "raw";
  const signedUrl = media.cloudinaryPublicId
    ? signedDeliveryUrl(media.cloudinaryPublicId, resourceType)
    : "";
  const attempts = [
    ...(signedUrl ? [{ source: "signed" as const, url: signedUrl }] : []),
    { source: "stored" as const, url: media.mediaUrl },
  ];

  try {
    let upstream: Response | null = null;
    const failures: Array<{ source: string; status: number; cldError: string }> = [];

    for (const attempt of attempts) {
      let response: Response;
      try {
        response = await fetch(attempt.url, {
          redirect: "error",
          signal: AbortSignal.timeout(20_000),
        });
      } catch (error) {
        // Timeout ou redirect recusado numa tentativa não pode impedir a seguinte.
        failures.push({
          source: attempt.source,
          status: 0,
          cldError: error instanceof Error ? error.message : "fetch falhou",
        });
        continue;
      }
      if (response.ok) {
        upstream = response;
        break;
      }
      // O `x-cld-error` é onde o Cloudinary explica a recusa ("PDF delivery is
      // disabled", assinatura inválida). Sem ele o diagnóstico exigia outro deploy.
      failures.push({
        source: attempt.source,
        status: response.status,
        cldError: response.headers.get("x-cld-error") || "",
      });
      await response.body?.cancel();
    }

    if (!upstream) {
      const upstreamStatus = failures[0]?.status ?? 0;
      logger.warn(
        {
          failures,
          resourceType,
          hasPublicId: Boolean(media.cloudinaryPublicId),
          conversationId,
          messageId,
        },
        "Cloudinary PDF download failed",
      );
      return NextResponse.json(
        {
          error: `Não foi possível carregar o PDF armazenado (Cloudinary ${upstreamStatus}).`,
        },
        { status: 502 },
      );
    }

    const declaredLength = Number(upstream.headers.get("content-length") || 0);
    if (declaredLength > MAX_PDF_BYTES) {
      return NextResponse.json(
        { error: "O PDF excede o limite de visualização de 20 MB." },
        { status: 413 },
      );
    }

    const bytes = await readBodyWithLimit(upstream, MAX_PDF_BYTES);
    if (!bytes) {
      return NextResponse.json(
        { error: "O PDF excede o limite de visualização de 20 MB." },
        { status: 413 },
      );
    }
    if (!hasPdfHeader(bytes)) {
      return NextResponse.json(
        { error: "O anexo armazenado não contém um PDF válido." },
        { status: 415 },
      );
    }

    // BodyInit accepts ArrayBuffer, while the stream reader exposes an
    // Uint8Array<ArrayBufferLike> that can also be backed by SharedArrayBuffer.
    const pdfBody = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(pdfBody).set(bytes);

    return new NextResponse(pdfBody, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${shouldDownload ? "attachment" : "inline"}; filename="documento-${messageId.slice(0, 12)}.pdf"`,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        organizationId: auth.session.organizationId,
        conversationId,
        messageId,
      },
      "Failed to proxy stored PDF",
    );
    return NextResponse.json(
      { error: "Não foi possível abrir o PDF agora. Tente novamente." },
      { status: 502 },
    );
  }
}

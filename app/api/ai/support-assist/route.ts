import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api";
import { consumeRateLimit, rateLimitSubject } from "@/lib/security/rate-limit";

const schema = z
  .object({
    operation: z.enum(["suggest_reply", "summarize"]),
    subject: z.string().max(500).optional(),
    context: z.string().min(1).max(12_000),
  })
  .strict();

export async function POST(request: Request) {
  const auth = await requireSession();
  if (auth.error || !auth.session) return auth.error;
  const limit = await consumeRateLimit(
    "support-ai",
    rateLimitSubject(`${auth.session.organizationId}:${auth.session.userId}`),
    20,
    60,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Limite temporário de assistência por IA atingido" },
      { status: limit.unavailable ? 503 : 429 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
  }
  const baseUrl = process.env.MAVO_AI_BASE_URL?.replace(/\/$/, "");
  const token = process.env.MAVO_AI_TOKEN;
  if (!baseUrl || !token) {
    return NextResponse.json(
      { error: "Assistência por IA não configurada" },
      { status: 503 },
    );
  }
  try {
    const response = await fetch(`${baseUrl}/v1/support/assist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Tenant-Id": auth.session.organizationId,
      },
      body: JSON.stringify({
        operation: parsed.data.operation,
        subject: parsed.data.subject,
        context: parsed.data.context,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return NextResponse.json(
        { error: "Serviço de IA indisponível" },
        { status: 502 },
      );
    }
    const result = (await response.json()) as {
      text?: unknown;
      reply?: unknown;
      summary?: unknown;
    };
    const text = String(result.text || result.reply || result.summary || "").trim();
    if (!text) {
      return NextResponse.json({ error: "Resposta de IA vazia" }, { status: 502 });
    }
    return NextResponse.json({ text: text.slice(0, 4_000) });
  } catch {
    return NextResponse.json(
      { error: "Serviço de IA indisponível" },
      { status: 502 },
    );
  }
}

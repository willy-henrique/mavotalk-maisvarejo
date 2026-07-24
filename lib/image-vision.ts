import { logger } from "@/lib/logger";
import { GROQ_LLAMA4_SCOUT_INSTRUCT } from "@/lib/llm-defaults";
import { isLikelyImagePayload } from "@/lib/vision-utils";

function getVisionApiBase(): string {
  const explicit = process.env.VISION_API_BASE_URL?.trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const aiBase = process.env.AI_BASE_URL?.trim().replace(/\/$/, "") || "";
  if (aiBase.includes("groq.com")) return aiBase;
  if (aiBase.includes("api.x.ai")) return aiBase;
  return "https://api.x.ai/v1";
}

function getVisionApiKey(): string {
  const fromEnv = (v: string | undefined) => String(v || "").trim();
  const base = getVisionApiBase();
  const dedicated = [
    process.env.VISION_API_KEY,
    process.env.XAI_API_KEY,
    process.env.WILLTALK_VISION_API_KEY,
    process.env.GROK_API_KEY,
  ];
  for (const c of dedicated) {
    const v = fromEnv(c);
    if (v) return v;
  }
  const ai = fromEnv(process.env.AI_API_KEY);
  const openai = fromEnv(process.env.OPENAI_API_KEY);
  const emb = fromEnv(process.env.EMBEDDING_API_KEY);
  if (base.includes("groq.com")) {
    return ai || "";
  }
  if (base.includes("openai.com")) {
    return openai || (!ai.startsWith("gsk_") ? ai : "") || emb;
  }
  if (ai && !ai.startsWith("gsk_")) return ai;
  return openai && !openai.startsWith("gsk_") ? openai : "";
}

function getVisionModel(baseUrl: string): string {
  const fromEnv = process.env.WILLTALK_VISION_MODEL || process.env.VISION_MODEL;
  if (fromEnv?.trim()) return fromEnv.trim();
  if (baseUrl.includes("groq.com")) return GROQ_LLAMA4_SCOUT_INSTRUCT;
  if (baseUrl.includes("openai.com")) return "gpt-4o-mini";
  return "grok-2-vision-1212";
}

export async function analyzeImageForSupport(params: {
  mediaUrl: string | null | undefined;
  mimeType: string | null | undefined;
  inboundBody: string;
}): Promise<string | null> {
  const { mediaUrl, mimeType, inboundBody } = params;
  if (!mediaUrl || !isLikelyImagePayload(mediaUrl, mimeType)) return null;

  const baseUrl = getVisionApiBase();
  const apiKey = getVisionApiKey();
  if (!apiKey) {
    logger.warn(
      {
        baseUrl,
        hint: baseUrl.includes("groq.com")
          ? "Defina AI_API_KEY (gsk_) para visao Groq (Llama 4 Scout)."
          : "Defina XAI_API_KEY ou VISION_API_KEY conforme o provedor.",
      },
      "vision_skipped_no_api_key",
    );
    return null;
  }

  const model = getVisionModel(baseUrl);
  const userText = String(inboundBody || "").trim() || "Cliente enviou uma imagem com problema técnico.";

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 280,
        messages: [
          {
            role: "system",
            content:
              "Voce e um analista de suporte tecnico. Analise a imagem e responda em portugues do Brasil com orientacao curta e pratica. " +
              "Formato: 1) o que foi identificado (resumo curto), 2) 2 a 4 passos objetivos para tentativa imediata, 3) pedir retorno com erro literal se persistir. " +
              "Nao invente dados. Nao solicite dados sensiveis.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: `Contexto do cliente: ${userText}` },
              { type: "image_url", image_url: { url: mediaUrl } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(45_000),
    });

    const rawBody = await res.text();
    if (!res.ok) {
      logger.warn(
        { status: res.status, baseUrl, model, bodyPreview: rawBody.slice(0, 400) },
        "vision_api_http_error",
      );
      return null;
    }
    let data: { choices?: Array<{ message?: { content?: string } }> };
    try {
      data = JSON.parse(rawBody) as { choices?: Array<{ message?: { content?: string } }> };
    } catch {
      logger.warn({ preview: rawBody.slice(0, 200) }, "vision_api_invalid_json");
      return null;
    }
    const content = String(data?.choices?.[0]?.message?.content || "").trim();
    if (!content) return null;
    return content.slice(0, 450);
  } catch (error) {
    logger.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        mediaUrl,
        baseUrl,
        model,
      },
      "vision_image_analysis_failed",
    );
    return null;
  }
}

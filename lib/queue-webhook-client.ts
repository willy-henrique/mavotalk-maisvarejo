import { logger } from "@/lib/logger";
import { createHmac, randomUUID } from "node:crypto";

export interface QueueWebhookClientParams {
  webhookUrl: string;
  webhookSecret: string;
  timeoutMs?: number;
  organizationId: string;
  conversationId: string;
  queueId: string;
  cliente: {
    nome: string;
    telefone: string;
  };
  mensagem: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  recentHistory?: Array<{
    direction: "inbound" | "outbound";
    text: string;
    at: string;
  }>;
}

export interface QueueWebhookResult {
  reply_text?: string;
  handoff: boolean;
  reason?: string;
}

export async function invokeQueueWebhook(
  params: QueueWebhookClientParams,
): Promise<QueueWebhookResult | null> {
  const { webhookUrl, webhookSecret, timeoutMs = 15000 } = params;
  if (!webhookUrl || !webhookSecret) return null;

  const eventId = `evt_${randomUUID()}`;
  const payload = {
    organization_id: params.organizationId,
    conversation_id: params.conversationId,
    queue_id: params.queueId,
    cliente: params.cliente,
    mensagem: params.mensagem,
    media_url: params.mediaUrl || null,
    mime_type: params.mimeType || null,
    historico_recente: params.recentHistory || [],
    event_id: eventId,
  };

  const payloadString = JSON.stringify(payload);
  const signature = createHmac("sha256", webhookSecret).update(payloadString).digest("hex");

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Mavo-Signature": `sha256=${signature}`,
        "X-Mavo-Queue-Id": params.queueId,
      },
      body: payloadString,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      logger.warn(
        { status: res.status, queueId: params.queueId },
        "queue_webhook_http_error",
      );
      return null;
    }

    const data = (await res.json().catch(() => ({}))) as {
      reply_text?: string;
      handoff?: boolean;
      reason?: string;
    };

    return {
      reply_text: typeof data.reply_text === "string" ? data.reply_text.trim() : undefined,
      handoff: Boolean(data.handoff),
      reason: data.reason || "ok",
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), queueId: params.queueId },
      "queue_webhook_invocation_failed",
    );
    return null;
  }
}

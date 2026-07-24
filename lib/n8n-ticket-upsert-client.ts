import { logger } from "@/lib/logger";

function ticketUpsertInternalUrl(): string {
  const base = process.env.WILLTALK_INTERNAL_BASE_URL?.trim();
  if (base) {
    return `${base.replace(/\/$/, "")}/api/webhooks/n8n/ticket-upsert`;
  }
  const port = process.env.PORT || "4002";
  const host = process.env.WILLTALK_INTERNAL_HOST || "127.0.0.1";
  return `http://${host}:${port}/api/webhooks/n8n/ticket-upsert`;
}

function buildFallbackInternalUrls(primaryUrl: string): string[] {
  const urls = [primaryUrl];
  const host = process.env.WILLTALK_INTERNAL_HOST || "127.0.0.1";
  const fallbackPorts = ["4002", "4003"];
  for (const port of fallbackPorts) {
    const candidate = `http://${host}:${port}/api/webhooks/n8n/ticket-upsert`;
    if (!urls.includes(candidate)) urls.push(candidate);
  }
  return urls;
}

/** Payload mínimo para `POST /api/webhooks/n8n/ticket-upsert` (bot-first / Cérebro v3). */
export type InvokeTicketUpsertPayload = {
  event_id: string;
  canal: "whatsapp";
  organization_id?: string;
  cliente: { nome: string; telefone: string };
  mensagem: string;
  mediaUrl?: string;
  mimeType?: string;
  /** Metadados opcionais (ex.: `ingest_origin` para pular janela anti-loop em ingestão direta). */
  metadata?: Record<string, unknown>;
};

/**
 * Chama o ticket-upsert no próprio servidor (loopback).
 * Usado com `WILLTALK_N8N_ONLY=true` para validar Bearer e centralizar triagem + envio WhatsApp.
 */
export async function invokeTicketUpsertLocal(payload: InvokeTicketUpsertPayload): Promise<{
  ok: boolean;
  status: number;
  data: unknown;
}> {
  const token = process.env.WILLTALK_WEBHOOK_TOKEN?.trim();
  if (!token) {
    logger.warn({}, "invokeTicketUpsertLocal: WILLTALK_WEBHOOK_TOKEN ausente");
    return { ok: false, status: 0, data: { error: "missing_webhook_token" } };
  }

  const primaryUrl = ticketUpsertInternalUrl();
  const candidateUrls = buildFallbackInternalUrls(primaryUrl);

  const body: Record<string, unknown> = {
    event_id: payload.event_id,
    canal: payload.canal,
    cliente: payload.cliente,
    mensagem: payload.mensagem,
  };
  if (payload.organization_id) body.organization_id = payload.organization_id;
  if (payload.mediaUrl) body.mediaUrl = payload.mediaUrl;
  if (payload.mimeType) body.mimeType = payload.mimeType;
  if (payload.metadata && Object.keys(payload.metadata).length > 0) {
    body.metadata = payload.metadata;
  }

  let lastError: unknown = null;
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data: unknown = await res.json().catch(() => ({}));
      logger.info(
        {
          status: res.status,
          event_id: payload.event_id,
          action: (data as Record<string, unknown>)?.action,
          triageCompleted: (data as Record<string, unknown>)?.triageCompleted,
          internalUrl: url,
        },
        "invokeTicketUpsertLocal",
      );
      return { ok: res.ok, status: res.status, data };
    } catch (err) {
      lastError = err;
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), event_id: payload.event_id, internalUrl: url },
        "invokeTicketUpsertLocal attempt failed",
      );
    }
  }

  logger.error(
    {
      err: lastError instanceof Error ? lastError.message : String(lastError),
      event_id: payload.event_id,
      triedUrls: candidateUrls,
    },
    "invokeTicketUpsertLocal failed",
  );
  return { ok: false, status: 0, data: { error: "fetch_failed" } };
}

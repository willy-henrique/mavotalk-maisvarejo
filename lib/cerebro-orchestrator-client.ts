import { logger } from "@/lib/logger";

export type CerebroOrchestratorQueue = {
  id: string;
  menuOption: number;
  name: string;
  defaultSlaMins?: number;
  isActive?: boolean;
};

export type InvokeCerebroOrchestratorParams = {
  baseUrl: string;
  token?: string;
  organizationId: string;
  eventId: string;
  conversationId: string;
  cliente: { nome: string; telefone: string };
  mensagem: string;
  mediaUrl?: string | null;
  mimeType?: string | null;
  businessOpen: boolean;
  conversation: {
    triage_completed: boolean;
    menu_attempts: number;
    queue_id: string | null;
  };
  queues: CerebroOrchestratorQueue[];
};

export type CerebroOrchestratorResult = {
  reply_text: string;
  triage_completed: boolean;
  menu_attempts: number;
  queue_id: string | null;
  reason: string;
};

/** Aceita base (http://host:3000) ou URL completa do endpoint. */
export function resolveCerebroOrchestratorEndpoint(raw: string): string {
  const trimmed = String(raw || "").trim().replace(/\/$/, "");
  if (!trimmed) return "";
  if (trimmed.includes("/api/orquestrador")) return trimmed;
  return `${trimmed}/api/orquestrador/v1/mensagem`;
}

export async function invokeCerebroOrchestrator(
  params: InvokeCerebroOrchestratorParams,
): Promise<CerebroOrchestratorResult | null> {
  const url = resolveCerebroOrchestratorEndpoint(params.baseUrl);
  if (!url) return null;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Source-System": "willtalk",
    "X-Tenant-Id": params.organizationId,
    "X-Ingestion-Id": params.eventId,
    "X-Source-Entity-Id": params.conversationId,
  };
  const token = String(params.token || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const body = {
    platform: "willtalk",
    organization_id: params.organizationId,
    event_id: params.eventId,
    conversation_id: params.conversationId,
    cliente: params.cliente,
    mensagem: params.mensagem,
    media_url: params.mediaUrl || undefined,
    mime_type: params.mimeType || undefined,
    business_hours_open: params.businessOpen,
    conversation: {
      triage_completed: params.conversation.triage_completed,
      menu_attempts: params.conversation.menu_attempts,
      queue_id: params.conversation.queue_id,
    },
    queues: params.queues.map((q) => ({
      id: q.id,
      menu_option: q.menuOption,
      name: q.name,
      default_sla_mins: q.defaultSlaMins,
      is_active: q.isActive,
    })),
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(18_000),
    });

    const data = (await res.json().catch(() => ({}))) as {
      reply_text?: string;
      triage_completed?: boolean;
      menu_attempts?: number;
      queue_id?: string | null;
      reason?: string;
      error?: string;
    };

    if (!res.ok) {
      logger.warn(
        { status: res.status, error: data.error, reason: data.reason },
        "cerebro_orchestrator_http_error",
      );
      if (typeof data.reply_text === "string" && data.reply_text.trim()) {
        return {
          reply_text: data.reply_text.trim(),
          triage_completed: Boolean(data.triage_completed),
          menu_attempts: Number(data.menu_attempts ?? params.conversation.menu_attempts),
          queue_id: data.queue_id === undefined || data.queue_id === "" ? null : String(data.queue_id),
          reason: String(data.reason || "error_body"),
        };
      }
      return null;
    }

    if (!data.reply_text || !String(data.reply_text).trim()) {
      logger.warn({ data }, "cerebro_orchestrator_empty_reply");
      return null;
    }

    return {
      reply_text: String(data.reply_text).trim(),
      triage_completed: Boolean(data.triage_completed),
      menu_attempts: Number(data.menu_attempts ?? 0),
      queue_id: data.queue_id === undefined || data.queue_id === "" ? null : String(data.queue_id),
      reason: String(data.reason || "ok"),
    };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "cerebro_orchestrator_fetch_failed");
    return null;
  }
}

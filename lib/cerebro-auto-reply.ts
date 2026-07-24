import crypto from "crypto";
import twilio from "twilio";
import { z } from "zod";
import { addOutboundMessage, createAuditLog, listConversations } from "@/lib/repo";
import { logger } from "@/lib/logger";
import { emitRealtime } from "@/lib/realtime";
import { DEFAULT_ORGANIZATION_ID } from "@/lib/utils";
import { sendWhatsappMessage } from "@/lib/whatsapp-client";

export const cerebroAutoReplySchema = z.object({
  ticket_id: z.string().min(1),
  cliente: z.string().optional(),
  /** Se enviado, o número deve bater com o contato da conversa (evita resposta no número errado). */
  cliente_telefone: z.string().min(8).optional(),
  canal: z.string().min(1),
  resposta_sugerida: z.string().min(1),
  origem: z.string().optional(),
  data_evento: z.string().optional(),
});

export type CerebroAutoReplyPayload = z.infer<typeof cerebroAutoReplySchema>;

type AutoReplyStatus = "received" | "sent" | "duplicate_ignored" | "error";

type AutoReplyResult = {
  statusCode: number;
  body: Record<string, unknown>;
};

type ConversationListItem = {
  id: string;
  contact?: { phoneNumber?: string | null; name?: string | null } | null;
  ticket?: { id?: string | null } | null;
};

type ConversationTarget = {
  organizationId: string;
  conversationId: string;
  contactPhone: string;
};

const DEDUPE_WINDOW_MS = 5 * 60 * 1000;
const dedupeMap = new Map<string, number>();

function normalizePath(path: string) {
  const trimmed = path.trim();
  if (!trimmed) return "/";
  const withPrefix = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withPrefix.replace(/\/+$/, "") || "/";
}

function normalizeTicketKey(raw: string) {
  return raw
    .replace(/^WT-/i, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function summarizePayload(payload: Partial<CerebroAutoReplyPayload>) {
  const preview = payload.resposta_sugerida ? compactText(payload.resposta_sugerida).slice(0, 160) : "";
  return {
    ticket_id: payload.ticket_id ?? null,
    canal: payload.canal ?? null,
    origem: payload.origem ?? null,
    resposta_preview: preview || null,
  };
}

async function logAutoReplyEvent(params: {
  organizationId?: string;
  ticketId: string | null;
  payload: Partial<CerebroAutoReplyPayload>;
  status: AutoReplyStatus;
  error?: string | null;
}) {
  const metadata = {
    ticket_id: params.ticketId,
    payload: summarizePayload(params.payload),
    status: params.status,
    erro: params.error ?? null,
    created_at: new Date().toISOString(),
  };

  if (params.status === "error") {
    logger.error(metadata, "Cerebro auto-reply");
  } else {
    logger.info(metadata, "Cerebro auto-reply");
  }

  try {
    await createAuditLog(
      params.organizationId || DEFAULT_ORGANIZATION_ID,
      null,
      "cerebro_auto_reply",
      "webhook",
      params.ticketId || "ticket-desconhecido",
      metadata,
    );
  } catch (error) {
    logger.warn({ err: error, metadata }, "Failed to persist cerebro auto-reply audit log");
  }
}

function makeDedupeKey(ticketId: string, respostaSugerida: string) {
  const hash = crypto.createHash("sha256").update(compactText(respostaSugerida)).digest("hex");
  return `${ticketId}:${hash}`;
}

function cleanupDedupe(now: number) {
  for (const [key, ts] of dedupeMap.entries()) {
    if (now - ts > DEDUPE_WINDOW_MS) dedupeMap.delete(key);
  }
}

function isDuplicateRecentlySent(key: string) {
  const now = Date.now();
  cleanupDedupe(now);
  const previous = dedupeMap.get(key);
  if (!previous) return false;
  return now - previous <= DEDUPE_WINDOW_MS;
}

function markAsSent(key: string) {
  dedupeMap.set(key, Date.now());
}

function buildFinalMessage(respostaSugerida: string) {
  const text = respostaSugerida.trim();
  return (
    "Olá! Identificamos uma sugestão automática para seu chamado:\n\n" +
    `${text}\n\n` +
    "Se não resolver, responda esta mensagem e um técnico assume o caso."
  );
}

async function findConversationTarget(ticketId: string): Promise<ConversationTarget | null> {
  const organizationId = DEFAULT_ORGANIZATION_ID;
  const targetRaw = ticketId.trim();

  const conversations = (await listConversations(organizationId)) as ConversationListItem[];
  const strictMatches = conversations.filter((item) => {
    const conversationId = String(item.id || "");
    const ticketRecordId = item.ticket?.id ? String(item.ticket.id) : "";
    return targetRaw === conversationId || targetRaw === ticketRecordId;
  });

  const pickValidTarget = (items: ConversationListItem[]): ConversationTarget | null => {
    if (items.length !== 1) return null;
    const only = items[0];
    const contactPhone = only?.contact?.phoneNumber ? String(only.contact.phoneNumber) : "";
    if (!contactPhone) return null;
    return {
      organizationId,
      conversationId: String(only.id),
      contactPhone,
    };
  };

  return pickValidTarget(strictMatches);
}

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

function phoneNumbersMatch(a: string, b: string): boolean {
  const da = digitsOnly(a);
  const db = digitsOnly(b);
  if (!da || !db) return false;
  return da === db || da.endsWith(db) || db.endsWith(da);
}

async function sendToWhatsapp(contactPhone: string, text: string) {
  const dryRun = String(process.env.WILLTALK_DRY_RUN_WHATSAPP || "").toLowerCase() === "true";
  if (dryRun) {
    logger.info(
      { contactPhone, textLength: text.length },
      "Auto-reply WhatsApp send simulated (WILLTALK_DRY_RUN_WHATSAPP=true)",
    );
    return `dryrun-${Date.now()}`;
  }

  const provider = process.env.WHATSAPP_PROVIDER || "twilio";

  if (provider === "unofficial") {
    return sendWhatsappMessage(contactPhone, text, {
      skipRateLimit: true,
      fromBot: true,
    });
  }

  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;
  if (!twilioSid || !twilioToken || !twilioFrom) {
    throw new Error("Twilio nao configurado para envio automatico");
  }

  const client = twilio(twilioSid, twilioToken);
  const sent = await client.messages.create({
    from: twilioFrom,
    to: contactPhone,
    body: text,
  });
  return sent.sid;
}

export function isAutoReplyEnabled() {
  return String(process.env.WILLTALK_AUTO_REPLY_ENABLED || "").toLowerCase() === "true";
}

export function isAutoReplyRouteAllowed(requestUrl: string) {
  const configured = normalizePath(process.env.WILLTALK_AUTO_REPLY_ROUTE || "/webhooks/cerebro/reply");
  const pathname = new URL(requestUrl).pathname;
  const requestRoute = normalizePath(pathname.replace(/^\/api/, ""));
  return requestRoute === configured;
}

export function hasValidAutoReplyToken(authorizationHeader: string | null) {
  const expectedToken = process.env.WILLTALK_WEBHOOK_TOKEN || "";
  if (!expectedToken) return false;
  if (!authorizationHeader) return false;
  const [scheme, token] = authorizationHeader.split(" ");
  if ((scheme || "").toLowerCase() !== "bearer") return false;
  if (!token) return false;
  return token.trim() === expectedToken;
}

export async function processCerebroAutoReply(payload: CerebroAutoReplyPayload): Promise<AutoReplyResult> {
  const expectedSource = (process.env.WILLTALK_AUTO_REPLY_SOURCE || "cerebro-operacional").trim().toLowerCase();
  const incomingSource = (payload.origem || "").trim().toLowerCase();

  await logAutoReplyEvent({
    ticketId: payload.ticket_id,
    payload,
    status: "received",
  });

  if (incomingSource && incomingSource !== expectedSource) {
    await logAutoReplyEvent({
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: "origem_invalida",
    });
    return { statusCode: 400, body: { error: "origem_invalida" } };
  }

  if ((payload.canal || "").trim().toLowerCase() !== "whatsapp") {
    await logAutoReplyEvent({
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: "canal_nao_suportado",
    });
    return { statusCode: 400, body: { error: "canal_nao_suportado" } };
  }

  const dedupeKey = makeDedupeKey(payload.ticket_id, payload.resposta_sugerida);
  if (isDuplicateRecentlySent(dedupeKey)) {
    await logAutoReplyEvent({
      ticketId: payload.ticket_id,
      payload,
      status: "duplicate_ignored",
    });
    return { statusCode: 200, body: { message: "duplicate_ignored" } };
  }

  const normalizedTicket = normalizeTicketKey(payload.ticket_id);
  if (normalizedTicket.length < 8) {
    await logAutoReplyEvent({
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: "ticket_id_invalido",
    });
    return { statusCode: 400, body: { error: "ticket_id_invalido" } };
  }

  const target = await findConversationTarget(payload.ticket_id);
  if (!target) {
    await logAutoReplyEvent({
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: "ticket_nao_encontrado",
    });
    return { statusCode: 404, body: { error: "ticket_nao_encontrado" } };
  }

  if (payload.cliente_telefone && !phoneNumbersMatch(payload.cliente_telefone, target.contactPhone)) {
    await logAutoReplyEvent({
      organizationId: target.organizationId,
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: "telefone_nao_confere_ticket",
    });
    return { statusCode: 409, body: { error: "telefone_nao_confere_ticket" } };
  }

  const finalMessage = buildFinalMessage(payload.resposta_sugerida);

  let externalId: string | undefined;
  try {
    externalId = await sendToWhatsapp(target.contactPhone, finalMessage);
  } catch (error) {
    const message = error instanceof Error ? error.message : "erro_desconhecido";
    await logAutoReplyEvent({
      organizationId: target.organizationId,
      ticketId: payload.ticket_id,
      payload,
      status: "error",
      error: message,
    });
    return { statusCode: 502, body: { error: "whatsapp_send_failed" } };
  }

  try {
    const message = await addOutboundMessage(
      target.organizationId,
      target.conversationId,
      finalMessage,
      externalId,
      { skipStatusUpdate: true },
    );
    emitRealtime(target.organizationId, "message.created", { conversationId: target.conversationId, message });
  } catch (error) {
    logger.warn(
      {
        err: error,
        ticket_id: payload.ticket_id,
        conversationId: target.conversationId,
      },
      "Auto-reply sent to WhatsApp but failed to persist outbound message",
    );
  }

  markAsSent(dedupeKey);

  await logAutoReplyEvent({
    organizationId: target.organizationId,
    ticketId: payload.ticket_id,
    payload,
    status: "sent",
  });

  return {
    statusCode: 200,
    body: {
      message: "sent",
      conversation_id: target.conversationId,
    },
  };
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { isOpenBusinessHour } from "@/lib/business-hours";
import {
  addInboundMessage,
  addOutboundMessage,
  createAuditLog,
  findMessageByExternalId,
  getOrCreateContactAndOpenConversation,
  isContactBlocked,
  listConversations,
  listQueues,
  resolveDefaultOrganizationId,
  updateConversationById,
  updateTicketByConversation,
} from "@/lib/repo";
import { emitRealtime } from "@/lib/realtime";
import { invokeCerebroOrchestrator } from "@/lib/cerebro-orchestrator-client";
import { analyzeImageForSupport } from "@/lib/image-vision";
import { logger } from "@/lib/logger";
import { decideSupermarketBot } from "@/lib/supermarket-bot";
import { getSupermarketBotConfigForOrganization } from "@/lib/supermarket-settings";
import { applySupermarketQueuePreset } from "@/lib/supermarket-setup";
import {
  buildOutOfHoursNotice,
} from "@/lib/utils";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";
import { sendTriageMessageToWhatsApp } from "@/lib/whatsapp-client";
import { routeBusinessWhatsappMessage } from "@/lib/business-access/business-whatsapp-router";
import { requestIdFrom } from "@/lib/observability";
import { timingSafeEqual } from "node:crypto";

const ticketUpsertSchema = z.object({
  event_id: z.string().trim().min(1).max(160),
  canal: z.literal("whatsapp"),
  organization_id: z.string().trim().min(1).max(128).optional(),
  cliente: z.object({
    nome: z.string().trim().min(1).max(160),
    telefone: z.string().trim().min(8).max(32),
  }),
  mensagem: z.string().min(1).max(20_000).optional(),
  body: z.string().min(1).max(20_000).optional(),
  media_url: z.string().url().max(2_048).optional(),
  mediaUrl: z.string().url().max(2_048).optional(),
  mime_type: z.string().min(1).max(160).optional(),
  mimeType: z.string().min(1).max(160).optional(),
  queue_id: z.string().min(1).max(128).optional(),
  prioridade: z.enum(["baixa", "media", "alta", "critica"]).optional(),
  ticket_ref: z.string().min(1).max(128).optional(),
  ticket_id: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type DecisionAction = "created" | "updated" | "ignored_duplicate" | "human_handoff" | "error";

type DecisionPayload = {
  action: DecisionAction;
  conversationStatus: "aguardando" | "em_atendimento" | "pendente_cliente" | "encerrado" | null;
  triageCompleted: boolean | null;
  menuAttempts: number | null;
  queueId: string | null;
  shouldReply: boolean;
  replyText: string | null;
  replyDelivered: boolean | null;
  events: string[];
  webhooks: string[];
  reason: string;
  organizationId?: string;
  contactId?: string | null;
  conversationId?: string | null;
  ticketId?: string | null;
  duplicate?: boolean;
  created?: boolean;
};

function decisionBase(partial: Partial<DecisionPayload>): DecisionPayload {
  return {
    action: "updated",
    conversationStatus: null,
    triageCompleted: null,
    menuAttempts: null,
    queueId: null,
    shouldReply: false,
    replyText: null,
    replyDelivered: null,
    events: [],
    webhooks: [],
    reason: "ok",
    ...partial,
  };
}

function getBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const [type, token] = authorizationHeader.split(" ");
  if (!type || !token) return null;
  if (type.toLowerCase() !== "bearer") return null;
  return token.trim();
}

function isLocalTicketUpsertBypassAllowed(requestUrl: string): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const allowBypass =
    String(process.env.WILLTALK_ALLOW_LOCAL_UPSERT_NO_AUTH || "").toLowerCase() === "true";
  if (!allowBypass) return false;
  try {
    const host = new URL(requestUrl).hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

function safeTokenEqual(received: string | null, expected: string): boolean {
  if (!received || !expected) return false;
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function webhookTokenForOrganization(organizationId: string): string {
  const boundOrganization =
    normalizeOrganizationId(process.env.WILLTALK_WEBHOOK_ORGANIZATION_ID) ||
    normalizeOrganizationId(process.env.DEFAULT_ORG_ID) ||
    "org_willtalk_default";
  if (organizationId === boundOrganization) {
    return process.env.WILLTALK_WEBHOOK_TOKEN || "";
  }
  try {
    const configured = JSON.parse(
      process.env.WILLTALK_WEBHOOK_TENANT_TOKENS_JSON || "{}",
    ) as Record<string, unknown>;
    return typeof configured[organizationId] === "string"
      ? String(configured[organizationId])
      : "";
  } catch {
    return "";
  }
}

function normalizeWhatsAppPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  const withCountry = digits.startsWith("55") ? digits : `55${digits}`;
  return `whatsapp:+${withCountry}`;
}

function normalizeOrganizationId(input: string | undefined): string {
  const raw = String(input || "").trim();
  if (!raw) return "";
  // Accept values accidentally wrapped in quotes from shell scripts.
  const unquoted = raw.replace(/^['"]+|['"]+$/g, "").trim();
  return unquoted;
}

function parseInboundType(mimeType?: string | null): "text" | "image" | "document" | "audio" {
  if (!mimeType) return "text";
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

const EMIT_WEBHOOKS_FROM_TICKET_UPSERT =
  String(process.env.WILLTALK_TICKET_UPSERT_EMIT_WEBHOOKS || "").toLowerCase() === "true";
const AI_TRIAGE_ONLY = String(process.env.WILLTALK_AI_TRIAGE_ONLY || "true").toLowerCase() !== "false";
const AI_APPEND_OUT_OF_HOURS =
  String(process.env.WILLTALK_AI_APPEND_OUT_OF_HOURS || "true").toLowerCase() !== "false";
const SUPERMARKET_AUTO_APPLY_PRESET =
  String(process.env.SUPERMARKET_AUTO_APPLY_PRESET || "true").toLowerCase() !== "false";
/** Base URL do Cérebro (Mavo): ex. http://127.0.0.1:3000 — triagem/orquestrador rodam lá. */
const CEREBRO_ORCHESTRATOR_URL = String(process.env.CEREBRO_ORCHESTRATOR_URL || "").trim();
const DUPLICATE_WINDOW_MS = 8000;
const recentInboundWindow = new Map<string, number>();
const TRIAGE_REPEAT_GUARD_MS = 45_000;
const recentTriagePromptWindow = new Map<string, number>();

const HISTORY_TRUNC_MARKER = /\[historico truncado:/i;

/**
 * Evita que eco do webhook (consolidação com `[historico truncado: ...]`) vire mensagem gigante
 * e quebre triagem / inbox. Extrai a última fala do cliente quando possível.
 */
function normalizeInboundEchoPayload(raw: string): { triageText: string; storageText: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { triageText: "", storageText: "" };
  if (trimmed.length <= 2000 && !HISTORY_TRUNC_MARKER.test(trimmed)) {
    return { triageText: trimmed, storageText: trimmed };
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.length > 0);
  const lastClientLine = [...lines].reverse().find((line) => /\|\s*cliente:\s*/i.test(line));
  let extracted = "";
  if (lastClientLine) {
    const match = lastClientLine.match(/\|\s*cliente:\s*(.+)$/i);
    extracted = (match ? match[1] : lastClientLine).trim();
  }
  if (!extracted && HISTORY_TRUNC_MARKER.test(trimmed)) {
    const afterFirst = trimmed.includes("\n") ? trimmed.split("\n").slice(1).join("\n").trim() : "";
    const lastLine = afterFirst.split("\n").pop()?.trim() || "";
    const m2 = lastLine.match(/\|\s*cliente:\s*(.+)$/i);
    extracted = (m2 ? m2[1] : lastLine).trim();
  }
  if (!extracted) {
    extracted = lines.slice(-5).join(" ").slice(0, 1200);
  }
  if (!extracted) {
    extracted = trimmed.slice(0, 500);
  }

  const storageText =
    extracted.length > 0 && extracted.length < trimmed.length
      ? `[eco de historico omitido] ${extracted.slice(0, 2000)}`
      : extracted.slice(0, 2000);
  return {
    triageText: extracted.slice(0, 4000),
    storageText: storageText.slice(0, 4000),
  };
}

function appendOutOfHours(text: string, isOpen: boolean): string {
  return isOpen ? text : text + buildOutOfHoursNotice();
}

function buildSmartGuidanceFromMessage(text: string): string | null {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return null;

  if (
    t.includes("banco de dados") ||
    t.includes("conexao com o banco") ||
    t.includes("conectar no banco") ||
    t.includes("postgres")
  ) {
    return (
      "Entendi seu cenário. Vamos tentar resolver agora: 1) confirme se o serviço do banco está ativo, " +
      "2) valide host, porta, usuário, senha e nome do banco, 3) teste a conexão no pgAdmin, " +
      "4) verifique firewall/VPN/rede e reinicie a aplicação após o ajuste. Se quiser, te guio passo a passo."
    );
  }

  if (t.includes("fiscal") || t.includes("nota") || t.includes("sefaz")) {
    return (
      "Vamos validar juntos: 1) confirme internet e data/hora do servidor, 2) verifique certificado digital válido, " +
      "3) tente emitir novamente e me envie o erro literal/print da tela. Com isso eu te passo o próximo passo com precisão."
    );
  }

  if (t.includes("impressora") || t.includes("etiqueta")) {
    return (
      "Vamos testar rapidamente: 1) confira se a impressora está online e sem fila travada, " +
      "2) valide cabo/rede e impressora padrão no sistema, 3) faça um teste de impressão local e me envie o erro retornado."
    );
  }

  if (t.includes("lent") || t.includes("trav")) {
    return (
      "Entendi. Vamos tentar estabilizar: 1) feche e reabra o sistema, 2) valide internet/rede local, " +
      "3) verifique uso alto de CPU/memória no servidor e me diga em qual tela a lentidão acontece."
    );
  }

  return null;
}

function buildAiFallbackReply(triageCompleted: boolean, inboundBody: string): string {
  const guidance = buildSmartGuidanceFromMessage(inboundBody);
  if (guidance) return guidance;
  if (triageCompleted) {
    return "Perfeito, triagem concluida. Ja encaminhei seu chamado para o time responsavel e vamos seguir por aqui."
  }
  return "Entendi. Para classificar corretamente, me informe apenas o modulo afetado e se o impacto esta total ou parcial."
}

function getMetadataString(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): string | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function getMetadataBoolean(
  metadata: Record<string, unknown> | undefined,
  keys: string[],
): boolean | null {
  if (!metadata) return null;
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true") return true;
      if (normalized === "false") return false;
    }
  }
  return null;
}

async function resolveTicketId(
  organizationId: string,
  conversationId: string,
): Promise<string | null> {
  const conversations = await listConversations(organizationId);
  const found = conversations.find((item) => String(item.id) === conversationId);
  if (!found?.ticket?.id) return null;
  return String(found.ticket.id);
}

async function resolveConversationTargetByTicketRef(params: {
  organizationId: string;
  normalizedPhone: string;
  ticketRef: string;
}): Promise<string | null> {
  const conversations = await listConversations(params.organizationId);
  const samePhone = conversations.filter(
    (item) =>
      String((item?.contact as { phoneNumber?: string | null } | undefined)?.phoneNumber || "") ===
      params.normalizedPhone,
  );
  const refRaw = params.ticketRef.trim();

  const exactMatches = samePhone.filter((item) => {
    const conversationId = String(item.id || "");
    const ticketId = item.ticket?.id ? String(item.ticket.id) : "";
    return refRaw === conversationId || refRaw === ticketId;
  });
  if (exactMatches.length === 1) {
    return String(exactMatches[0].id);
  }
  return null;
}

export async function POST(request: Request) {
  const incomingToken = getBearerToken(request.headers.get("authorization"));
  const requestId = requestIdFrom(request);
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 1_048_576) {
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "payload_excedeu_limite" }),
      { status: 413 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    logger.warn({ status: "error", error: "invalid_json" }, "n8n ticket-upsert invalid json");
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "payload_invalido" }),
      { status: 400 },
    );
  }

  const parsed = ticketUpsertSchema.safeParse(body);
  if (!parsed.success) {
    logger.warn(
      { status: "error", error: "payload_invalido", details: parsed.error.flatten() },
      "n8n ticket-upsert payload validation failed",
    );
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "payload_invalido" }),
      { status: 400 },
    );
  }

  const payload = parsed.data;
  const rawOrganizationId =
    normalizeOrganizationId(payload.organization_id) ||
    normalizeOrganizationId(process.env.DEFAULT_ORG_ID) ||
    "org_willtalk_default";
  // O Bearer token é validado contra o valor bruto do env (o inbound do WhatsApp
  // envia esse mesmo valor não resolvido), então a checagem abaixo não é afetada
  // pela autocorreção de organizationId feita logo em seguida.
  const expectedToken = webhookTokenForOrganization(rawOrganizationId);
  const tokenOk = safeTokenEqual(incomingToken, expectedToken);
  if (!tokenOk && !isLocalTicketUpsertBypassAllowed(request.url)) {
    logger.warn(
      { status: "error", error: "unauthorized", requestId },
      "n8n ticket-upsert unauthorized",
    );
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "unauthorized" }),
      { status: 401 },
    );
  }
  if (!tokenOk) {
    logger.warn(
      { status: "warning", reason: "local_no_auth_bypass_enabled", requestId },
      "n8n ticket-upsert accepted without bearer token in local mode",
    );
  }

  const organizationId = await resolveDefaultOrganizationId(rawOrganizationId);

  const inboundRaw = (payload.mensagem || payload.body || "").trim();
  const { triageText: inboundBody, storageText: inboundStorageText } =
    normalizeInboundEchoPayload(inboundRaw);
  const mediaUrl = payload.mediaUrl || payload.media_url || null;
  const mimeType = payload.mimeType || payload.mime_type || null;

  if (!inboundBody && !mediaUrl) {
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "mensagem_ou_midia_obrigatoria" }),
      { status: 400 },
    );
  }

  const normalizedPhone = normalizeWhatsAppPhone(payload.cliente.telefone);
  if (!normalizedPhone) {
    return NextResponse.json(
      decisionBase({ action: "error", shouldReply: false, reason: "telefone_invalido" }),
      { status: 400 },
    );
  }

  const businessRouting = await routeBusinessWhatsappMessage({
    organizationId,
    phone: normalizedPhone,
    message: inboundBody || (mediaUrl ? "[mídia]" : ""),
    conversationReference: payload.event_id,
    requestId,
  });
  if (businessRouting.destination === "business") {
    let replyDelivered: boolean | null = null;
    if (businessRouting.reply) {
      const dryRun =
        String(process.env.WILLTALK_DRY_RUN_WHATSAPP || "").toLowerCase() ===
        "true";
      if (!dryRun) {
        try {
          await sendTriageMessageToWhatsApp(
            normalizedPhone,
            businessRouting.reply,
            { skipRateLimit: true, fromBot: true },
          );
          replyDelivered = true;
        } catch (error) {
          replyDelivered = false;
          logger.error(
            {
              err: error,
              organizationId,
              requestId,
              route: "business",
            },
            "Business WhatsApp reply failed",
          );
        }
      } else {
        replyDelivered = true;
        logger.info(
          {
            organizationId,
            requestId,
            route: "business",
            textLength: businessRouting.reply.length,
          },
          "Business WhatsApp reply simulated",
        );
      }
    }
    return NextResponse.json(
      decisionBase({
        action:
          businessRouting.reason === "duplicate"
            ? "ignored_duplicate"
            : "updated",
        shouldReply: Boolean(businessRouting.reply),
        replyText: businessRouting.reply || null,
        replyDelivered,
        reason: `business_${businessRouting.reason}`,
        duplicate: businessRouting.reason === "duplicate",
        organizationId,
        created: false,
      }),
      { status: 200 },
    );
  }

  if (await isContactBlocked(organizationId, normalizedPhone)) {
    logger.info(
      { organizationId, normalizedPhone, requestId },
      "n8n ticket-upsert ignored blocked contact",
    );
    return NextResponse.json(
      decisionBase({
        action: "updated",
        reason: "contact_blocked",
        organizationId,
        created: false,
      }),
      { status: 200 },
    );
  }

  // Anti-loop guard: n8n/workflow retries can regenerate event_id, so we also
  // suppress same inbound payload for the same phone in a short time window.
  // Ingestão direta do WhatsApp (unofficial) não aplica esta janela — evita bloquear repetições legítimas.
  const skipDuplicateWindow =
    String(payload.metadata?.ingest_origin || "").toLowerCase() === "whatsapp-unofficial";
  const inboundFingerprint = `${organizationId}|${normalizedPhone}|${String(inboundBody || "").trim()}|${String(mediaUrl || "")}|${String(mimeType || "")}`;
  const now = Date.now();
  const lastSeen = recentInboundWindow.get(inboundFingerprint) || 0;
  if (!skipDuplicateWindow && now - lastSeen <= DUPLICATE_WINDOW_MS) {
    logger.warn(
      { organizationId, normalizedPhone, eventId: payload.event_id, duplicateWindowMs: DUPLICATE_WINDOW_MS },
      "n8n ticket-upsert suppressed by anti-loop window",
    );
    return NextResponse.json(
      decisionBase({
        action: "ignored_duplicate",
        reason: "duplicate_inbound_window",
        duplicate: true,
        organizationId,
      }),
      { status: 200 },
    );
  }
  if (!skipDuplicateWindow) {
    recentInboundWindow.set(inboundFingerprint, now);
  }

  const duplicate = await findMessageByExternalId(organizationId, payload.event_id);
  if (duplicate) {
    const duplicateConversationId = String(duplicate.conversationId || "");
    const duplicateTicketId = duplicateConversationId
      ? await resolveTicketId(organizationId, duplicateConversationId)
      : null;
    logger.info(
      { organizationId, externalId: payload.event_id, duplicate: true },
      "n8n ticket-upsert duplicate ignored",
    );
    return NextResponse.json(
      decisionBase({
        action: "ignored_duplicate",
        reason: "external_id_duplicado",
        duplicate: true,
        organizationId,
        contactId: null,
        conversationId: duplicateConversationId || null,
        ticketId: duplicateTicketId,
        created: false,
      }),
      { status: 200 },
    );
  }

  const { contact, conversation: initialConversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    normalizedPhone,
    payload.cliente.nome,
  );
  let conversation = initialConversation;

  const ticketRef = payload.ticket_id || payload.ticket_ref;
  if (ticketRef) {
    const targetConversationId = await resolveConversationTargetByTicketRef({
      organizationId,
      normalizedPhone,
      ticketRef,
    });
    if (!targetConversationId) {
      return NextResponse.json(
        decisionBase({
          action: "error",
          shouldReply: false,
          reason: "ticket_ambiguo_revisao_humana",
          organizationId,
          contactId: contact.id,
        }),
        { status: 409 },
      );
    }
    if (targetConversationId !== String(conversation.id)) {
      const conversations = await listConversations(organizationId);
      const found = conversations.find((item) => String(item.id) === targetConversationId);
      if (found) {
        conversation = {
          id: String(found.id),
          organizationId,
          contactId: String(found.contact?.id || conversation.contactId),
          contactPhone: String(
            (found.contact as { phoneNumber?: string | null } | undefined)?.phoneNumber || normalizedPhone,
          ),
          queueId: found.queue?.id ? String(found.queue.id) : null,
          status: String(found.status || "aguardando") as
            | "aguardando"
            | "em_atendimento"
            | "pendente_cliente"
            | "encerrado",
          triageCompleted: Boolean(found.triageCompleted),
          menuAttempts: Number((found as { menuAttempts?: number }).menuAttempts || 0),
          isNew: false,
        };
      }
    }
  }

  // ── Persist inbound message ──────────────────────────────────────────
  const inbound = await addInboundMessage({
    organizationId,
    conversationId: String(conversation.id),
    externalId: payload.event_id,
    type: parseInboundType(mimeType),
    content: inboundStorageText || inboundBody || "[midia]",
    mediaUrl,
    mimeType,
    cloudinaryPublicId: null,
  });

  const events: string[] = ["message.created"];
  const webhooks: string[] = [];
  emitRealtime(organizationId, "message.created", { conversationId: String(conversation.id), message: inbound });
  const conversationRealtimeEvent = conversation.isNew ? "conversation.created" : "conversation.updated";
  events.push(conversationRealtimeEvent);
  emitRealtime(organizationId, conversationRealtimeEvent, {
    id: String(conversation.id),
    status: "aguardando",
    queueId: payload.queue_id || null,
  });

  await createAuditLog(
    organizationId,
    null,
    "n8n_ticket_upsert",
    "conversation",
    String(conversation.id),
    {
      origem: "n8n",
      canal: payload.canal,
      externalId: payload.event_id,
      prioridade: payload.prioridade || null,
      ticketRef: payload.ticket_ref || payload.ticket_id || null,
      metadata: payload.metadata || {},
      queueId: payload.queue_id || null,
    },
  );

  const businessOpen = await isOpenBusinessHour(new Date(), organizationId);
  const supermarketConfig = await getSupermarketBotConfigForOrganization(organizationId);

  // ── TRIAGE LOGIC (SUPERMARKET-FIRST) ──────────────────────────────
  let allQueues = await listQueues(organizationId);
  let supermarketQueuesReady = false;
  if (supermarketConfig.enabled) {
    // Bootstrap único: só cria as filas padrão quando o tenant nunca teve nenhuma.
    // Não roda de novo a cada mensagem, senão desativar/excluir uma fila no painel
    // seria desfeito automaticamente pela próxima mensagem do cliente.
    supermarketQueuesReady = allQueues.length > 0;
    if (!supermarketQueuesReady && SUPERMARKET_AUTO_APPLY_PRESET) {
      try {
        const presetResult = await applySupermarketQueuePreset(organizationId, null);
        allQueues = presetResult.queues;
        supermarketQueuesReady = allQueues.length > 0;
        logger.info(
          {
            organizationId,
            created: presetResult.created,
            updated: presetResult.updated,
            paused: presetResult.paused,
          },
          "Supermarket queue preset synchronized automatically",
        );
      } catch (error) {
        logger.error(
          {
            organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to synchronize supermarket queue preset; using standard triage",
        );
      }
    }
  }

  const queues = allQueues.filter((q) => q.isActive !== false);
  const queueFromPayload = payload.queue_id
    ? queues.find((item) => String(item.id) === payload.queue_id)
    : null;
  const aiReplyTextRaw = getMetadataString(payload.metadata, ["reply_text", "ai_reply_text", "resposta_sugerida"]);
  const aiTriageCompletedMeta = getMetadataBoolean(payload.metadata, ["triage_completed", "triageCompleted"]);

  let action: DecisionAction = conversation.isNew ? "created" : "updated";
  let shouldReply = false;
  let replyText: string | null = null;
  let replyMediaUrl: string | null = null;
  let replyDelivered: boolean | null = null;
  let triageCompleted = Boolean(conversation.triageCompleted);
  let menuAttempts = Number(conversation.menuAttempts || 0);
  let queueId: string | null = conversation.queueId ? String(conversation.queueId) : null;
  let conversationStatus: DecisionPayload["conversationStatus"] = "aguardando";
  let decisionReason = "inbound_processado_com_regras_de_identidade_triagem_e_seguranca";

  const currentQueue = queues.find(
    (item) => String(item.id) === String(conversation.queueId || ""),
  );
  const supermarketDecision = supermarketQueuesReady
    ? decideSupermarketBot({
        message: inboundBody || (mediaUrl ? "Imagem ou arquivo enviado" : ""),
        customerName: contact.name || payload.cliente.nome,
        isNewConversation: Boolean(conversation.isNew),
        triageCompleted: Boolean(conversation.triageCompleted),
        currentQueueMenuOption: currentQueue ? Number(currentQueue.menuOption) : null,
        businessOpen,
        config: supermarketConfig,
        activeMenuOptions: queues.map((item) => Number(item.menuOption)),
      })
    : null;

  if (supermarketDecision) {
    const targetQueue = supermarketDecision.queueMenuOption
      ? queues.find(
          (item) => Number(item.menuOption) === supermarketDecision.queueMenuOption,
        )
      : null;
    const previousQueueId = conversation.queueId ? String(conversation.queueId) : null;
    queueId = supermarketDecision.clearQueue
      ? null
      : targetQueue
        ? String(targetQueue.id)
        : previousQueueId;
    triageCompleted = supermarketDecision.triageCompleted;
    menuAttempts = supermarketDecision.kind === "collect-details" ? 0 : menuAttempts;
    decisionReason = supermarketDecision.reason;

    if (queueId !== previousQueueId) {
      const firstResponseDueAt = targetQueue
        ? new Date(Date.now() + Number(targetQueue.defaultSlaMins || 30) * 60 * 1000)
        : null;
      await updateTicketByConversation(organizationId, String(conversation.id), {
        queueId,
        firstResponseDueAt,
      });
    }

    await updateConversationById(organizationId, String(conversation.id), {
      queueId,
      triageCompleted,
      menuAttempts,
      status: "aguardando",
    });

    shouldReply = Boolean(supermarketDecision.replyText);
    replyText = supermarketDecision.replyText;
    replyMediaUrl = supermarketDecision.mediaUrl || null;
    if (
      replyText &&
      supermarketDecision.appendOutOfHours &&
      AI_APPEND_OUT_OF_HOURS &&
      !businessOpen
    ) {
      replyText = appendOutOfHours(replyText, businessOpen);
    }
    if (
      supermarketDecision.kind === "human-handoff" ||
      supermarketDecision.kind === "silent-human"
    ) {
      action = "human_handoff";
    }

    logger.info(
      {
        organizationId,
        conversationId: String(conversation.id),
        kind: supermarketDecision.kind,
        reason: supermarketDecision.reason,
        queueId,
        shouldReply,
      },
      "Supermarket bot decision applied",
    );
  } else if (AI_TRIAGE_ONLY) {
    const useCerebroOrchestrator = Boolean(CEREBRO_ORCHESTRATOR_URL);

    if (useCerebroOrchestrator) {
      const orchestratorToken =
        String(process.env.CEREBRO_ORCHESTRATOR_TOKEN || "").trim() ||
        String(process.env.CEREBRO_INGEST_TOKEN || "").trim();

      const orch = await invokeCerebroOrchestrator({
        baseUrl: CEREBRO_ORCHESTRATOR_URL,
        token: orchestratorToken || undefined,
        organizationId,
        eventId: payload.event_id,
        conversationId: String(conversation.id),
        cliente: payload.cliente,
        mensagem: inboundBody || (mediaUrl ? "[midia]" : ""),
        mediaUrl,
        mimeType,
        businessOpen,
        conversation: {
          triage_completed: Boolean(conversation.triageCompleted),
          menu_attempts: Number(conversation.menuAttempts || 0),
          queue_id: conversation.queueId ? String(conversation.queueId) : null,
        },
        queues: queues.map((q) => ({
          id: String(q.id),
          menuOption: Number(q.menuOption),
          name: String(q.name),
          defaultSlaMins: Number(q.defaultSlaMins || 30),
          isActive: q.isActive !== false,
        })),
      });

      if (orch) {
        triageCompleted = orch.triage_completed;
        menuAttempts = orch.menu_attempts;
        const prevQueueId = conversation.queueId ? String(conversation.queueId) : null;
        queueId = orch.queue_id;

        if (queueId && String(prevQueueId || "") !== String(queueId)) {
          const qMeta = queues.find((item) => String(item.id) === String(queueId));
          const slaMins = Number(qMeta?.defaultSlaMins || 30);
          const dueAt = new Date(Date.now() + slaMins * 60 * 1000);
          await updateTicketByConversation(organizationId, String(conversation.id), {
            queueId: String(queueId),
            firstResponseDueAt: dueAt,
          });
        }

        await updateConversationById(organizationId, String(conversation.id), {
          queueId: queueId || undefined,
          triageCompleted,
          menuAttempts,
          status: "aguardando",
        });

        shouldReply = true;
        replyText = orch.reply_text;
      }
    }

    if (!useCerebroOrchestrator || !replyText) {
      const nextTriageCompleted = aiTriageCompletedMeta ?? Boolean(queueFromPayload || conversation.triageCompleted);
      triageCompleted = nextTriageCompleted;

      if (queueFromPayload) {
        const slaMins = Number(queueFromPayload.defaultSlaMins || 30);
        const dueAt = new Date(Date.now() + slaMins * 60 * 1000);
        queueId = String(queueFromPayload.id);
        await updateTicketByConversation(organizationId, String(conversation.id), {
          queueId,
          firstResponseDueAt: dueAt,
        });
      }

      await updateConversationById(organizationId, String(conversation.id), {
        queueId: queueId || undefined,
        triageCompleted: nextTriageCompleted,
        status: "aguardando",
      });

      const aiProvidedReply = Boolean(aiReplyTextRaw && aiReplyTextRaw.trim());
      const triageGuardKey = `${organizationId}|${normalizedPhone}|${String(conversation.id)}`;
      const lastTriagePromptAt = recentTriagePromptWindow.get(triageGuardKey) || 0;
      const canRepeatFallbackPrompt = now - lastTriagePromptAt > TRIAGE_REPEAT_GUARD_MS;

      if (!aiProvidedReply && !nextTriageCompleted && !canRepeatFallbackPrompt) {
        shouldReply = false;
        replyText = null;
        logger.info(
          { organizationId, conversationId: String(conversation.id), normalizedPhone, guardMs: TRIAGE_REPEAT_GUARD_MS },
          "Suppressed repeated fallback triage prompt for rapid consecutive messages",
        );
      } else {
        const imageGuidance = aiProvidedReply
          ? null
          : await analyzeImageForSupport({ mediaUrl, mimeType, inboundBody });
        const aiReplyFinal = (aiReplyTextRaw || imageGuidance || buildAiFallbackReply(nextTriageCompleted, inboundBody)).trim();
        shouldReply = true;
        replyText =
          AI_APPEND_OUT_OF_HOURS && !businessOpen
            ? appendOutOfHours(aiReplyFinal, businessOpen)
            : aiReplyFinal;
        if (!aiProvidedReply && !nextTriageCompleted) {
          recentTriagePromptWindow.set(triageGuardKey, now);
        }
      }
    }
  } else if (conversation.status === "encerrado") {
    await updateConversationById(organizationId, String(conversation.id), { status: "aguardando" });
    conversationStatus = "aguardando";
  }

  // ── SEND REPLY VIA WHATSAPP ────────────────────────────────────────
  const replyPhone = String(conversation.contactPhone || normalizedPhone);
  if (shouldReply && replyText) {
    replyDelivered = await sendReplyToWhatsApp(
      replyPhone,
      replyText,
      organizationId,
      String(conversation.id),
      replyMediaUrl,
    );
  }

  // ── OUTBOUND WEBHOOKS ──────────────────────────────────────────────
  // Anti-loop: this endpoint is part of the ingestion path. Re-emitting webhook
  // events from here can recursively trigger n8n -> ticket-upsert -> n8n...
  // Keep disabled by default and allow explicit opt-in by env.
  const webhookFallback = {
    cliente: contact.name,
    telefone: normalizedPhone,
    canal: payload.canal,
    mensagem: inboundBody || "[midia]",
    dataEvento: new Date().toISOString(),
  };

  if (EMIT_WEBHOOKS_FROM_TICKET_UPSERT) {
    if (conversation.isNew) {
      webhooks.push("ticket_created");
      void sendWillTalkWebhook({
        event: "ticket_created",
        organizationId,
        conversationId: String(conversation.id),
        fallback: webhookFallback,
      });
    } else {
      webhooks.push("ticket_updated");
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: webhookFallback,
      });
    }

    webhooks.push("message_received");
    void sendWillTalkWebhook({
      event: "message_received",
      organizationId,
      conversationId: String(conversation.id),
      fallback: webhookFallback,
    });

    if (shouldReply) {
      webhooks.push("message_sent");
      void sendWillTalkWebhook({
        event: "message_sent",
        organizationId,
        conversationId: String(conversation.id),
        fallback: webhookFallback,
      });
    }
  } else {
    webhooks.push("webhooks_suprimidos_no_ticket_upsert");
  }

  const ticketId = await resolveTicketId(organizationId, String(conversation.id));

  // Fire-and-forget: send to Cerebro when triage just completed
  if (triageCompleted && !conversation.triageCompleted) {
    const cerebroUrl = process.env.CEREBRO_INGESTAO_URL || "http://127.0.0.1:3000/api/ingestao/willtalk";
    const ingestToken = String(process.env.CEREBRO_INGEST_TOKEN || "").trim();
    const ingestHeaders: Record<string, string> = { "Content-Type": "application/json" };
    if (ingestToken) {
      ingestHeaders.Authorization = `Bearer ${ingestToken}`;
    }
    fetch(cerebroUrl, {
      method: "POST",
      headers: ingestHeaders,
      body: JSON.stringify({
        ticket_id: ticketId || String(conversation.id),
        cliente: payload.cliente.nome,
        canal: payload.canal,
        mensagens: inboundBody || "[midia]",
        tecnico: "Mavo Talk",
        data_evento: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch((err) => {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err), conversationId: String(conversation.id) },
        "Cerebro ingestao fire-and-forget failed (non-blocking)",
      );
    });
  }

  logger.info(
    {
      organizationId,
      contactId: contact.id,
      conversationId: String(conversation.id),
      ticketId,
      created: Boolean(conversation.isNew),
      externalId: payload.event_id,
      triageCompleted,
      menuAttempts,
      queueId,
      shouldReply,
    },
    "n8n ticket-upsert processed",
  );

  return NextResponse.json(
    decisionBase({
      action,
      conversationStatus,
      triageCompleted,
      menuAttempts,
      queueId,
      shouldReply,
      replyText,
      replyDelivered,
      events,
      webhooks,
      reason: decisionReason,
      duplicate: false,
      organizationId,
      contactId: contact.id,
      conversationId: String(conversation.id),
      ticketId,
      created: Boolean(conversation.isNew),
    }),
    { status: 200 },
  );
}

// ── Helper: send triage reply and persist as outbound ────────────────
async function sendReplyToWhatsApp(
  normalizedPhone: string,
  text: string,
  organizationId: string,
  conversationId: string,
  mediaUrl?: string | null,
): Promise<boolean> {
  const dryRun = String(process.env.WILLTALK_DRY_RUN_WHATSAPP || "").toLowerCase() === "true";
  if (dryRun) {
    const externalId = `dryrun-${Date.now()}`;
    await addOutboundMessage(organizationId, conversationId, text, externalId, {
      skipStatusUpdate: true,
      type: mediaUrl ? "image" : "text",
      mediaUrl: mediaUrl || null,
    });
    emitRealtime(organizationId, "message.created", {
      conversationId,
      message: { content: text, direction: "outbound", type: "text" },
    });
    logger.info(
      { conversationId, externalId, channel: "dry-run", textLength: text.length },
      "Triage reply simulated (WILLTALK_DRY_RUN_WHATSAPP=true)",
    );
    return true;
  }

  try {
    const { externalId, channel } = await sendTriageMessageToWhatsApp(normalizedPhone, text, {
      skipRateLimit: true,
      fromBot: true,
      mediaUrl: mediaUrl || undefined,
    });

    await addOutboundMessage(organizationId, conversationId, text, externalId || undefined, {
      skipStatusUpdate: true,
      type: mediaUrl ? "image" : "text",
      mediaUrl: mediaUrl || null,
    });

    emitRealtime(organizationId, "message.created", {
      conversationId,
      message: { content: text, direction: "outbound", type: "text" },
    });

    logger.info(
      { conversationId, externalId, channel, textLength: text.length },
      "Triage reply sent via WhatsApp",
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const hint =
      msg.includes("nao inicializado") || msg.includes("nao esta pronto") || msg.includes("desconectado")
        ? " Conecte o WhatsApp no painel (QR) ou configure Twilio com WILLTALK_TRIAGE_TWILIO_FALLBACK (padrao: true)."
        : "";
    logger.error(
      { conversationId, error: msg, hint: hint.trim() || undefined },
      `Failed to send triage reply via WhatsApp${hint}`,
    );
    return false;
  }
}

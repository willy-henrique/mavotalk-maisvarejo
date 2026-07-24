import qrcode from "qrcode";
import twilio from "twilio";
import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  getContentType,
  DisconnectReason,
  Browsers,
  type WASocket,
  type WAMessage,
  type AnyMessageContent,
  proto,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { isOpenBusinessHour } from "@/lib/business-hours";
import { uploadBase64ToCloudinary } from "@/lib/cloudinary";
import {
  addInboundMessage,
  addOutboundMessage,
  listQueues,
  findMessageByExternalId,
  getOrCreateContactAndOpenConversation,
  updateConversationById,
  updateTicketByConversation,
  updateContactAvatar,
} from "@/lib/repo";
import { logger } from "@/lib/logger";
import { emitRealtime } from "@/lib/realtime";
import { invokeTicketUpsertLocal } from "@/lib/n8n-ticket-upsert-client";
import {
  buildInvestigationAiReply,
  buildQuickGuidance,
  INVESTIGATION_AI_ROUNDS,
} from "@/lib/investigation-reply";
import { DEFAULT_ORGANIZATION_ID, buildDemandMenu } from "@/lib/utils";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";
import { routeBusinessWhatsappMessage } from "@/lib/business-access/business-whatsapp-router";
import {
  isDirectUserJid,
  resolvePhoneJid,
  whatsappPhoneFromJid,
} from "@/lib/whatsapp-addressing";

type WhatsappStatus = "idle" | "initializing" | "qr" | "ready" | "disconnected" | "error";

type WhatsappState = {
  status: WhatsappStatus;
  qrDataUrl: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

type KnownError = { message?: string };

declare global {
  var __waClient: WASocket | undefined;
  var __waState: WhatsappState | undefined;
  var __waInitPromise: Promise<WhatsappState> | undefined;
  var __waDestroyPromise: Promise<void> | undefined;
  var __waUnhandledRejectionHooked: boolean | undefined;
}

function getState(): WhatsappState {
  if (!global.__waState) {
    global.__waState = {
      status: "idle",
      qrDataUrl: null,
      lastError: null,
      connectedPhone: null,
    };
  }
  return global.__waState;
}

function phoneToChatId(phone: string) {
  const digits = phone.replace("whatsapp:", "").replace(/\D/g, "");
  return `${digits}@s.whatsapp.net`;
}

function isDirectUserChat(jid: string): boolean {
  return isDirectUserJid(jid);
}

async function resolveMessagePhone(
  sock: WASocket,
  msg: WAMessage,
): Promise<string | null> {
  const phoneJid = await resolvePhoneJid(
    {
      remoteJid: msg.key?.remoteJid,
      remoteJidAlt: msg.key?.remoteJidAlt,
    },
    (lid) => sock.signalRepository.lidMapping.getPNForLID(lid),
  );
  return whatsappPhoneFromJid(phoneJid);
}

/** Tipos de conteúdo Baileys que não representam uma mensagem real de conversa. */
const WA_IGNORE_CONTENT_TYPES = new Set([
  "protocolMessage",
  "reactionMessage",
  "senderKeyDistributionMessage",
  "pollUpdateMessage",
  "pollCreationMessage",
  "messageContextInfo",
  "call",
]);

/** Evita processar status, broadcast, notificações de sistema e ruído que não é conversa 1:1 real. */
function shouldIgnoreInboundWhatsApp(msg: WAMessage): boolean {
  if (msg.broadcast) return true;
  const jid = String(msg.key?.remoteJid || "");
  if (jid === "status@broadcast" || /@broadcast$/i.test(jid)) return true;
  if (msg.messageStubType) return true;
  const contentType = getContentType(msg.message || undefined);
  if (!contentType || WA_IGNORE_CONTENT_TYPES.has(contentType)) return true;
  return false;
}

function extractMessageText(message: proto.IMessage | null | undefined): string {
  if (!message) return "";
  const text =
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    "";
  return String(text || "").trim();
}

type InboundMediaKind = "image" | "audio" | "document" | null;

function detectInboundMedia(message: proto.IMessage | null | undefined): {
  kind: InboundMediaKind;
  mimeType?: string;
} {
  if (!message) return { kind: null };
  if (message.imageMessage) return { kind: "image", mimeType: message.imageMessage.mimetype || undefined };
  if (message.stickerMessage) return { kind: "image", mimeType: message.stickerMessage.mimetype || undefined };
  if (message.audioMessage) return { kind: "audio", mimeType: message.audioMessage.mimetype || undefined };
  if (message.videoMessage) return { kind: "document", mimeType: message.videoMessage.mimetype || undefined };
  if (message.documentMessage) return { kind: "document", mimeType: message.documentMessage.mimetype || undefined };
  return { kind: null };
}

async function downloadInboundMedia(
  msg: WAMessage,
): Promise<{ base64: string; mimeType?: string } | null> {
  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const { mimeType } = detectInboundMedia(msg.message);
    return { base64: buffer.toString("base64"), mimeType };
  } catch (err) {
    logger.warn({ err, id: msg.key?.id }, "Failed to download inbound WhatsApp media");
    return null;
  }
}

function isKnownWhatsappNoiseError(error: unknown): boolean {
  const message = String((error as KnownError)?.message || error || "").toLowerCase();
  return message.includes("timed out") || message.includes("connection closed");
}

function ensureUnhandledRejectionGuard() {
  if (global.__waUnhandledRejectionHooked) return;
  process.on("unhandledRejection", (reason) => {
    if (isKnownWhatsappNoiseError(reason)) {
      logger.warn({ err: reason }, "Suppressed known WhatsApp runtime noise");
      return;
    }
    logger.error({ err: reason }, "Unhandled rejection");
  });
  global.__waUnhandledRejectionHooked = true;
}

/** Intervalo mínimo entre envios (ms) para respeitar limites do WhatsApp e reduzir risco de ban. */
const WA_MIN_SEND_INTERVAL_MS = Number(process.env.WA_MIN_SEND_INTERVAL_MS) || 1500;
let lastSendAt = 0;

/** Timestamp Unix (segundos) do momento em que o cliente ficou pronto.
 * Mensagens com timestamp anterior a este valor são mensagens offline enfileiradas
 * e devem ser ignoradas para não disparar respostas automáticas indevidas. */
let clientReadyAt: number | null = null;

/** ChatIds de envios automáticos (bot) - mensagens enviadas por aqui não devem alterar status para em_atendimento. */
const recentBotSends = new Set<string>();

async function rateLimitedSend(sock: WASocket, jid: string, text: string, fromBot = false) {
  if (fromBot) recentBotSends.add(jid);
  const now = Date.now();
  const elapsed = now - lastSendAt;
  if (elapsed < WA_MIN_SEND_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, WA_MIN_SEND_INTERVAL_MS - elapsed));
  }
  lastSendAt = Date.now();
  return sock.sendMessage(jid, { text });
}

/** Persiste mensagens enviadas pelo celular (mesmo número conectado) para aparecer no Inbox.
 * Cria contato e conversa se não existirem, para que threads iniciadas pelo celular apareçam. */
async function processOutboundMessageFromDevice(
  sock: WASocket,
  msg: WAMessage,
) {
  const to = String(msg.key?.remoteJid || "");
  if (!msg.key?.fromMe || !isDirectUserChat(to)) return;

  const organizationId = DEFAULT_ORGANIZATION_ID;
  const toPhone = await resolveMessagePhone(sock, msg);
  if (!toPhone) {
    logger.warn(
      { to, toAlt: msg.key?.remoteJidAlt, id: msg.key?.id },
      "Ignoring outbound WhatsApp message without a resolvable phone JID",
    );
    return;
  }

  const fromBot = recentBotSends.has(to);
  if (fromBot) recentBotSends.delete(to);

  const { conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    toPhone,
    "Contato",
  );

  const body = extractMessageText(msg.message) || "[mídia]";

  // Nunca alterar status de conversa encerrada para em_atendimento (ex: mensagem de pesquisa de satisfação).
  // Só muda status para em_atendimento se for mensagem real do atendente (não bot, não nova, não encerrada).
  const conversationEncerrada = conversation.status === "encerrado";
  const skipStatusUpdate = conversation.isNew || fromBot || conversationEncerrada;

  const message = await addOutboundMessage(
    organizationId,
    conversation.id,
    body,
    msg.key?.id || undefined,
    skipStatusUpdate ? { skipStatusUpdate: true } : undefined,
  );

  let status: string;
  if (conversation.isNew) {
    status = "aguardando";
  } else if (fromBot || conversationEncerrada) {
    status = conversation.status;
  } else {
    status = "em_atendimento";
  }

  emitRealtime(organizationId, "message.created", { conversationId: conversation.id, message });
  emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: conversation.id,
    status,
  });
}

async function handleInboundViaBotTriagem(
  sock: WASocket,
  msg: WAMessage,
) {
  const remoteJid = String(msg.key?.remoteJid || "");
  const fromPhone = await resolveMessagePhone(sock, msg);
  if (!fromPhone) {
    logger.error(
      {
        from: remoteJid,
        fromAlt: msg.key?.remoteJidAlt,
        event_id: msg.key?.id,
      },
      "Inbound WhatsApp message has no resolvable phone JID",
    );
    await rateLimitedSend(
      sock,
      remoteJid,
      "Não consegui iniciar o atendimento automático agora. Por favor, tente novamente em instantes.",
      true,
    );
    return;
  }
  const contactName = msg.pushName || "Cliente";

  let inboundText = extractMessageText(msg.message);
  let mediaUrl: string | undefined;
  let mimeType: string | undefined;
  const { kind } = detectInboundMedia(msg.message);
  if (kind) {
    const downloaded = await downloadInboundMedia(msg);
    if (downloaded) {
      mimeType = downloaded.mimeType;
      try {
        const uploaded = await uploadBase64ToCloudinary(downloaded.base64, mimeType || null);
        mediaUrl = uploaded?.secure_url || undefined;
      } catch (err) {
        logger.warn(
          { err, from: remoteJid, id: msg.key?.id },
          "Failed to process inbound media for ticket-upsert",
        );
      }
    }
    if (!inboundText) {
      inboundText = kind === "image" ? "[imagem]" : "[midia]";
    }
  }

  if (!inboundText) inboundText = "[sem_texto]";

  const result = await invokeTicketUpsertLocal({
    event_id: msg.key?.id || `wa-${Date.now()}`,
    canal: "whatsapp",
    organization_id: DEFAULT_ORGANIZATION_ID,
    cliente: {
      nome: contactName,
      telefone: fromPhone,
    },
    mensagem: inboundText,
    mediaUrl,
    mimeType,
    metadata: { ingest_origin: "whatsapp-unofficial" },
  });
  if (!result.ok) {
    logger.error(
      {
        status: result.status,
        data: result.data,
        from: fromPhone,
        event_id: msg.key?.id,
        defaultOrgId: DEFAULT_ORGANIZATION_ID,
      },
      "ticket-upsert local failed — WhatsApp may reply but inbox will not update until fixed (check WILLTALK_WEBHOOK_TOKEN, WILLTALK_INTERNAL_BASE_URL/PORT, DEFAULT_ORG_ID vs user organization)",
    );
    await rateLimitedSend(
      sock,
      remoteJid,
      "Não consegui concluir o atendimento automático agora. Por favor, tente novamente em instantes.",
      true,
    );
    return;
  }

  const decision = result.data as {
    shouldReply?: unknown;
    replyText?: unknown;
    replyDelivered?: unknown;
    conversationId?: unknown;
    organizationId?: unknown;
  };
  if (
    decision.shouldReply === true &&
    decision.replyDelivered === false &&
    typeof decision.replyText === "string" &&
    decision.replyText.trim()
  ) {
    const sent = await rateLimitedSend(
      sock,
      remoteJid,
      decision.replyText.trim(),
      true,
    );
    const conversationId = String(decision.conversationId || "").trim();
    const organizationId = String(
      decision.organizationId || DEFAULT_ORGANIZATION_ID,
    ).trim();
    if (conversationId && organizationId === DEFAULT_ORGANIZATION_ID) {
      await addOutboundMessage(
        organizationId,
        conversationId,
        decision.replyText.trim(),
        sent?.key?.id || undefined,
        { skipStatusUpdate: true },
      );
    }
    logger.warn(
      {
        event_id: msg.key?.id,
        from: fromPhone,
        conversationId: conversationId || undefined,
      },
      "Recovered undelivered ticket-upsert reply using the original Baileys JID",
    );
  }
}

async function processInboundMessage(sock: WASocket, msg: WAMessage) {
  const remoteJid = String(msg.key?.remoteJid || "");
  if (msg.key?.fromMe || !isDirectUserChat(remoteJid)) return;
  if (shouldIgnoreInboundWhatsApp(msg)) return;

  // Ignora mensagens enfileiradas que chegaram enquanto o WhatsApp estava desconectado.
  // Quando o cliente reconecta, o Baileys reenvia notificações pendentes ("append") —
  // sem este filtro, o bot responderia a todos sem motivo.
  const messageTimestamp = Number(msg.messageTimestamp || 0);
  if (clientReadyAt !== null && messageTimestamp > 0 && messageTimestamp < clientReadyAt) {
    logger.debug(
      { from: remoteJid, msgTs: messageTimestamp, readyAt: clientReadyAt },
      "Skipping pre-connection queued message",
    );
    return;
  }

  const { kind: mediaKind } = detectInboundMedia(msg.message);
  const bodyRaw = extractMessageText(msg.message);
  const hasContent = Boolean(bodyRaw) || Boolean(mediaKind);
  if (!hasContent) {
    logger.debug({ from: remoteJid }, "Ignoring inbound with no body and no media");
    return;
  }

  const n8nOnlyMode = String(process.env.WILLTALK_N8N_ONLY || "").toLowerCase() === "true";
  const aiTriageOnlyMode = String(process.env.WILLTALK_AI_TRIAGE_ONLY || "true").toLowerCase() !== "false";
  if (n8nOnlyMode || aiTriageOnlyMode) {
    await handleInboundViaBotTriagem(sock, msg);
    return;
  }

  const organizationId = DEFAULT_ORGANIZATION_ID;
  const externalId = msg.key?.id || undefined;
  if (externalId) {
    try {
      const existing = await findMessageByExternalId(organizationId, externalId);
      if (existing) return;
    } catch (err) {
      logger.warn({ err, organizationId }, "Error checking duplicate message by externalId, processing as new");
    }
  }

  const fromPhone = await resolveMessagePhone(sock, msg);
  if (!fromPhone) {
    logger.error(
      { from: remoteJid, fromAlt: msg.key?.remoteJidAlt, externalId },
      "Unable to resolve inbound WhatsApp phone number",
    );
    return;
  }
  const body = bodyRaw;
  const profileName = (msg.pushName || "").trim() || "Cliente";

  let avatarUrl: string | null = null;
  try {
    const pic = await sock.profilePictureUrl(remoteJid, "image");
    if (pic) avatarUrl = String(pic);
  } catch {
    // sem foto de perfil ou sem permissão — ignora
  }

  const businessRouting = await routeBusinessWhatsappMessage({
    organizationId,
    phone: fromPhone,
    message: body || (mediaKind ? "[mídia]" : ""),
    conversationReference: externalId,
  });
  if (businessRouting.destination === "business") {
    if (businessRouting.reply) {
      await rateLimitedSend(sock, remoteJid, businessRouting.reply, true);
    }
    return;
  }

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    fromPhone,
    profileName,
  );

  if (avatarUrl) {
    void updateContactAvatar(organizationId, contact.id, avatarUrl).catch((err) => {
      logger.warn({ err, contactId: contact.id }, "Failed to update contact avatar");
    });
  }

  let mediaUrl: string | null = null;
  let mimeType: string | null = null;
  let cloudinaryPublicId: string | null = null;
  let type: "text" | "image" | "document" | "audio" = "text";

  if (mediaKind) {
    const downloaded = await downloadInboundMedia(msg);
    if (downloaded) {
      mimeType = downloaded.mimeType || null;
      type = mediaKind;
      try {
        const upload = await uploadBase64ToCloudinary(downloaded.base64, mimeType);
        mediaUrl = upload?.secure_url || null;
        cloudinaryPublicId = upload?.public_id || null;
      } catch {
        mediaUrl = null;
      }
    }
  }

  const inbound = await addInboundMessage({
    organizationId,
    conversationId: String(conversation.id),
    content: body || "[midia]",
    type,
    externalId: msg.key?.id || undefined,
    mediaUrl,
    mimeType,
    cloudinaryPublicId,
  });

  emitRealtime(organizationId, "message.created", { conversationId: conversation.id, message: inbound });
  if (conversation.isNew) {
    void sendWillTalkWebhook({
      event: "ticket_created",
      organizationId,
      conversationId: String(conversation.id),
      fallback: {
        cliente: contact.name,
        canal: "whatsapp",
        mensagem: body || "[midia]",
      },
    });
  }
  void sendWillTalkWebhook({
    event: "message_received",
    organizationId,
    conversationId: String(conversation.id),
    fallback: {
      cliente: contact.name,
      canal: "whatsapp",
      mensagem: body || "[midia]",
    },
  });

  const queues = (await listQueues(organizationId)).filter((q) => q.isActive !== false);

  const businessOpen = await isOpenBusinessHour(new Date(), organizationId);
  const outOfHoursSuffix = businessOpen
    ? ""
    : "\n\nEstamos fora do horario comercial no momento. Seu chamado foi registrado e responderemos no proximo expediente.";
  const buildInvestigationPrompt = (queueName?: string | null) => {
    const header = queueName
      ? `Perfeito, recebi sua demanda de *${queueName}*.`
      : "Perfeito, recebi sua demanda.";
    return `${header} Para te ajudar com mais precisão, me envie por favor: 1) print/foto da tela, 2) mensagem de erro exata e 3) se o impacto está total ou parcial.${outOfHoursSuffix}`;
  };

  if (!conversation.triageCompleted) {
    if (conversation.queueId) {
      const currentQueue = queues.find((item) => String(item.id) === String(conversation.queueId));
      const attempts = Number(conversation.menuAttempts || 0);

      if (attempts >= INVESTIGATION_AI_ROUNDS) {
        const quickGuidance = buildQuickGuidance(body);
        await updateConversationById(organizationId, String(conversation.id), {
          triageCompleted: true,
          menuAttempts: attempts + 1,
          status: "aguardando",
        });
        emitRealtime(organizationId, "conversation.updated", {
          id: String(conversation.id),
          queueId: String(conversation.queueId),
          status: "aguardando",
        });
        void sendWillTalkWebhook({
          event: "ticket_updated",
          organizationId,
          conversationId: String(conversation.id),
          fallback: { cliente: contact.name, canal: "whatsapp", mensagem: body || "[midia]" },
        });
        await rateLimitedSend(
          sock,
          remoteJid,
          `${quickGuidance ? `${quickGuidance}\n\n` : ""}Perfeito, obrigado pelas informações. Encaminhei seu chamado para o técnico responsável da fila *${String(currentQueue?.name || "Suporte")}* para continuidade.${outOfHoursSuffix}`,
          true,
        );
        return;
      }

      const reply = await buildInvestigationAiReply({
        roundIndex: attempts,
        body: body || (mimeType?.startsWith("image/") ? "[imagem]" : ""),
        mediaUrl,
        mimeType,
        queueName: String(currentQueue?.name || "Suporte"),
      });

      await updateConversationById(organizationId, String(conversation.id), {
        menuAttempts: attempts + 1,
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: { cliente: contact.name, canal: "whatsapp", mensagem: body || "[midia]" },
      });
      await rateLimitedSend(sock, remoteJid, `${reply}${outOfHoursSuffix}`, true);
      return;
    }

    const selectedOption = Number.parseInt(body, 10);
    const queue = queues.find((item) => Number(item.menuOption) === selectedOption);

    if (queues.length === 0) {
      await updateConversationById(organizationId, String(conversation.id), {
        triageCompleted: true,
        status: "aguardando",
      });
      emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: {
          cliente: contact.name,
          canal: "whatsapp",
          mensagem: body || "[midia]",
        },
      });
      await rateLimitedSend(
        sock,
        remoteJid,
        `Olá! Seu chamado foi registrado. Em breve um atendente responderá.${outOfHoursSuffix}`,
        true,
      );
      return;
    }

    if (Number.isInteger(selectedOption) && queue) {
      const dueAt = new Date(Date.now() + Number(queue.defaultSlaMins || 30) * 60 * 1000);

      await updateConversationById(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        triageCompleted: false,
        menuAttempts: 0,
        status: "aguardando",
      });

      await updateTicketByConversation(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        firstResponseDueAt: dueAt,
      });

      emitRealtime(organizationId, "conversation.updated", {
        id: String(conversation.id),
        queueId: String(queue.id),
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: {
          cliente: contact.name,
          canal: "whatsapp",
          mensagem: body || "[midia]",
        },
      });

      await rateLimitedSend(sock, remoteJid, buildInvestigationPrompt(String(queue.name)), true);
      return;
    }

    const nextAttempts = Number(conversation.menuAttempts || 0) + 1;

    if (nextAttempts >= 3) {
      await updateConversationById(organizationId, String(conversation.id), {
        triageCompleted: true,
        menuAttempts: nextAttempts,
        status: "aguardando",
      });

      emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
      });
      void sendWillTalkWebhook({
        event: "ticket_updated",
        organizationId,
        conversationId: String(conversation.id),
        fallback: {
          cliente: contact.name,
          canal: "whatsapp",
          mensagem: body || "[midia]",
        },
      });

      await rateLimitedSend(
        sock,
        remoteJid,
        `Nao consegui identificar a opcao selecionada. Seu chamado foi encaminhado para atendimento humano.${outOfHoursSuffix}`,
        true,
      );
      return;
    }

    await updateConversationById(organizationId, String(conversation.id), {
      menuAttempts: nextAttempts,
    });
    void sendWillTalkWebhook({
      event: "ticket_updated",
      organizationId,
      conversationId: String(conversation.id),
      fallback: {
        cliente: contact.name,
        canal: "whatsapp",
        mensagem: body || "[midia]",
      },
    });

    const menu = buildDemandMenu(
      queues.map((q) => ({
        menuOption: Number(q.menuOption),
        name: String(q.name),
      })),
      contact.name,
    );

    await rateLimitedSend(sock, remoteJid, `${menu}\n\nTentativa ${nextAttempts}/3.${outOfHoursSuffix}`, true);
    return;
  }

  // Se estava encerrado, reabre como aguardando (sem enviar mensagem automática — evita spawn).
  const wasClosed = conversation.status === "encerrado";
  const newStatus = wasClosed ? "aguardando" : conversation.status;

  await updateConversationById(organizationId, String(conversation.id), { status: newStatus });

  emitRealtime(organizationId, conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: String(conversation.id),
    status: newStatus,
  });
  void sendWillTalkWebhook({
    event: "ticket_updated",
    organizationId,
    conversationId: String(conversation.id),
    fallback: {
      cliente: contact.name,
      canal: "whatsapp",
      mensagem: body || "[midia]",
    },
  });

  // Nenhuma mensagem automática pós-triagem: o atendente responde pelo painel.
}

export function getWhatsappState() {
  return getState();
}

/** Aguarda o cliente unofficial ficar pronto (ex.: após `initWhatsappClient`). */
export async function waitForWhatsappReady(maxMs: number): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (getState().status === "ready") return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return getState().status === "ready";
}

const RECONNECT_DELAY_MS = 3_000;

export async function initWhatsappClient() {
  ensureUnhandledRejectionGuard();
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    return getState();
  }

  if (global.__waClient) {
    return getState();
  }

  if (global.__waInitPromise) {
    return global.__waInitPromise;
  }

  const state = getState();
  state.status = "initializing";
  state.lastError = null;

  const initPromise = (async () => {
    try {
      const authPath = process.env.WHATSAPP_AUTH_PATH || ".wwebjs_auth";
      const { state: authState, saveCreds } = await useMultiFileAuthState(authPath);
      const { version } = await fetchLatestBaileysVersion();

      const sock = makeWASocket({
        version,
        auth: authState,
        logger,
        browser: Browsers.appropriate(process.env.WHATSAPP_SESSION_NAME || "Mavo Talk"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          state.status = "qr";
          void qrcode.toDataURL(qr).then((url) => {
            state.qrDataUrl = url;
          });
        }

        if (connection === "open") {
          state.status = "ready";
          state.qrDataUrl = null;
          state.lastError = null;
          const rawId = sock.user?.id || "";
          const digits = rawId.split(":")[0]?.split("@")[0] || "";
          state.connectedPhone = digits ? `+${digits}` : null;
          clientReadyAt = Math.floor(Date.now() / 1000);
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          state.status = "disconnected";
          state.lastError = lastDisconnect?.error ? String(lastDisconnect.error.message || lastDisconnect.error) : null;
          state.connectedPhone = null;
          clientReadyAt = null;
          if (global.__waClient === sock) {
            global.__waClient = undefined;
          }

          if (!loggedOut) {
            setTimeout(() => {
              void initWhatsappClient().catch((err) => {
                logger.error({ err }, "Failed to auto-reconnect WhatsApp client");
              });
            }, RECONNECT_DELAY_MS).unref();
          } else {
            logger.warn("WhatsApp session logged out; reconnect requires a new QR Code");
          }
        }
      });

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;
        for (const msg of messages) {
          if (!msg.message) continue;
          if (msg.key?.fromMe) {
            void processOutboundMessageFromDevice(sock, msg).catch((error) => {
              logger.error({ err: error }, "Failed to process outbound WhatsApp message (device)");
            });
          } else {
            void processInboundMessage(sock, msg).catch((error) => {
              logger.error({ err: error }, "Failed to process inbound WhatsApp message");
            });
          }
        }
      });

      global.__waClient = sock;
      return state;
    } catch (error) {
      state.status = "error";
      state.lastError = String((error as KnownError)?.message || error);
      state.connectedPhone = null;
      global.__waClient = undefined;
      logger.error({ err: error }, "Failed to initialize WhatsApp client");
      throw error;
    } finally {
      global.__waInitPromise = undefined;
    }
  })();

  global.__waInitPromise = initPromise;
  return initPromise;
}

export async function destroyWhatsappClient() {
  if (global.__waDestroyPromise) {
    await global.__waDestroyPromise;
    return;
  }

  const destroyPromise = (async () => {
    if (!global.__waClient) return;
    try {
      global.__waClient.end(undefined);
    } catch (error) {
      if (!isKnownWhatsappNoiseError(error)) {
        logger.error({ err: error }, "Failed to destroy WhatsApp client");
      } else {
        logger.warn({ err: error }, "Ignoring known WhatsApp destroy noise");
      }
    } finally {
      global.__waClient = undefined;
      const state = getState();
      state.status = "disconnected";
      state.qrDataUrl = null;
      state.connectedPhone = null;
    }
  })();

  global.__waDestroyPromise = destroyPromise;
  try {
    await destroyPromise;
  } finally {
    global.__waDestroyPromise = undefined;
  }
}

/** Envia indicador de digitação para o contato no WhatsApp (apenas unofficial). */
export async function sendTypingIndicator(contactPhone: string): Promise<void> {
  const sock = global.__waClient;
  if (!sock || getState().status !== "ready") return;

  try {
    const jid = phoneToChatId(contactPhone);
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);
  } catch {
    // ignora erro (ex: chat não encontrado)
  }
}

function buildOutboundMediaContent(mediaUrl: string, caption?: string): AnyMessageContent {
  const clean = mediaUrl.split("?")[0].toLowerCase();
  if (/\.(jpe?g|png|gif|webp)$/.test(clean)) {
    return { image: { url: mediaUrl }, caption: caption || undefined };
  }
  if (/\.(mp4|3gp|mov)$/.test(clean)) {
    return { video: { url: mediaUrl }, caption: caption || undefined };
  }
  if (/\.(mp3|ogg|oga|m4a|wav|opus)$/.test(clean)) {
    return { audio: { url: mediaUrl }, mimetype: "audio/mpeg" };
  }
  const fileName = mediaUrl.split("/").pop() || "arquivo";
  const extMatch = /\.([a-z0-9]+)$/.exec(clean);
  const documentMimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };
  const mimetype = (extMatch && documentMimeTypes[extMatch[1]]) || "application/octet-stream";
  return { document: { url: mediaUrl }, mimetype, fileName, caption: caption || undefined };
}

/** Envio via Baileys (QR). Triagem/bot e `fromBot` usam apenas este caminho.
 * Mensagens do atendente pelo painel com Twilio continuam em `conversations/[id]/messages`. */
export async function sendWhatsappMessage(
  toPhone: string,
  text: string,
  options?: { skipRateLimit?: boolean; mediaUrl?: string; fromBot?: boolean },
) {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    throw new Error(
      "Triagem e envios automaticos usam o WhatsApp nao-oficial. Defina WHATSAPP_PROVIDER=unofficial e conecte o QR no painel.",
    );
  }

  const sock = global.__waClient;
  if (!sock) {
    throw new Error("WhatsApp client nao inicializado");
  }

  const state = getState();
  if (state.status !== "ready") {
    throw new Error("WhatsApp client ainda nao esta pronto");
  }

  const digits = toPhone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error(`Telefone invalido para envio WhatsApp: ${toPhone}`);
  }

  const jid = phoneToChatId(toPhone);

  // Marca como envio de bot ANTES de enviar, para que o listener de mensagens
  // gerado pelo Baileys (fromMe) seja reconhecido como automático.
  if (options?.fromBot) {
    recentBotSends.add(jid);
  }

  let sent: WAMessage | undefined;
  if (options?.mediaUrl) {
    sent = await sock.sendMessage(jid, buildOutboundMediaContent(options.mediaUrl, text));
  } else if (options?.skipRateLimit === true) {
    sent = await sock.sendMessage(jid, { text });
  } else {
    sent = await rateLimitedSend(sock, jid, text);
  }

  if (!sent?.key?.id) {
    throw new Error("Falha ao enviar mensagem: WhatsApp nao retornou confirmacao");
  }
  return sent.key.id;
}

const TRIAGE_READY_WAIT_MS = Number(process.env.WILLTALK_TRIAGE_READY_WAIT_MS) || 12_000;

/**
 * Triagem (ticket-upsert): tenta o WhatsApp nao-oficial com init + espera; se falhar ou nao estiver pronto,
 * usa Twilio quando configurado (`WILLTALK_TRIAGE_TWILIO_FALLBACK`, padrão true).
 */
export async function sendTriageMessageToWhatsApp(
  toPhone: string,
  text: string,
  options?: { skipRateLimit?: boolean; fromBot?: boolean },
): Promise<{ externalId: string; channel: "unofficial" | "twilio" }> {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_WHATSAPP_NUMBER;

  const sendViaTwilio = async () => {
    if (!twilioSid || !twilioToken || !twilioFrom) {
      throw new Error("Twilio nao configurado (fallback nao disponivel)");
    }
    const client = twilio(twilioSid, twilioToken);
    const sent = await client.messages.create({
      from: twilioFrom,
      to: toPhone,
      body: text,
    });
    return { externalId: sent.sid, channel: "twilio" as const };
  };

  if (provider !== "unofficial") {
    return sendViaTwilio();
  }

  await initWhatsappClient();
  const ready = await waitForWhatsappReady(TRIAGE_READY_WAIT_MS);
  if (ready) {
    try {
      const externalId = await sendWhatsappMessage(toPhone, text, options);
      return { externalId: String(externalId), channel: "unofficial" };
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), to: toPhone },
        "Triage send via unofficial failed; trying Twilio fallback",
      );
    }
  } else {
    logger.warn(
      { status: getState().status },
      "WhatsApp unofficial not ready after wait; trying Twilio fallback",
    );
  }

  const fallbackDisabled =
    String(process.env.WILLTALK_TRIAGE_TWILIO_FALLBACK || "true").toLowerCase() === "false";
  if (fallbackDisabled) {
    throw new Error(
      "WhatsApp unofficial nao esta pronto e WILLTALK_TRIAGE_TWILIO_FALLBACK=false",
    );
  }

  try {
    return await sendViaTwilio();
  } catch (twilioErr) {
    const tMsg = twilioErr instanceof Error ? twilioErr.message : String(twilioErr);
    throw new Error(
      `Envio triagem falhou (unofficial desconectado e Twilio: ${tMsg}). Conecte o QR ou configure Twilio.`,
    );
  }
}

import qrcode from "qrcode";
import twilio from "twilio";
import { Client, LocalAuth, type Message } from "whatsapp-web.js";
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

type WhatsappStatus = "idle" | "initializing" | "qr" | "ready" | "disconnected" | "error";

type WhatsappState = {
  status: WhatsappStatus;
  qrDataUrl: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

type KnownError = { message?: string };

declare global {
  var __waClient: Client | undefined;
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

function chatIdToPhone(chatId: string) {
  const digits = chatId.replace(/@(c\.us|lid)$/i, "").replace(/\D/g, "");
  return `whatsapp:+${digits}`;
}

function phoneToChatId(phone: string) {
  const digits = phone.replace("whatsapp:", "").replace(/\D/g, "");
  return `${digits}@c.us`;
}

function isDirectUserChat(chatId: string): boolean {
  return /@(c\.us|lid)$/i.test(String(chatId || ""));
}

/** Tipos internos do WhatsApp Web que não devem abrir triagem nem webhook. */
const WA_IGNORE_INBOUND_TYPES = new Set([
  "e2e_notification",
  "notification",
  "protocol",
  "gp2",
  "revoked",
  "ciphertext",
  "broadcast_notification",
  "reaction",
  "call_log",
]);

/** Evita processar status, broadcast e ruído que não é conversa 1:1 real. */
function shouldIgnoreInboundWhatsApp(msg: Message): boolean {
  const extended = msg as Message & { isStatus?: boolean; broadcast?: boolean };
  if (extended.isStatus || extended.broadcast) return true;
  const from = String(msg.from || "");
  if (from === "status@broadcast" || /@broadcast$/i.test(from)) return true;
  const t = String(msg.type || "");
  if (t && WA_IGNORE_INBOUND_TYPES.has(t)) return true;
  return false;
}

function isKnownWhatsappNoiseError(error: unknown): boolean {
  const message = String((error as KnownError)?.message || error || "").toLowerCase();
  return (
    message.includes("execution context was destroyed") ||
    (message.includes("ebusy") && message.includes("first_party_sets.db"))
  );
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

async function rateLimitedSend(client: Client, chatId: string, text: string, fromBot = false) {
  if (fromBot) recentBotSends.add(chatId);
  const now = Date.now();
  const elapsed = now - lastSendAt;
  if (elapsed < WA_MIN_SEND_INTERVAL_MS) {
    await new Promise((r) => setTimeout(r, WA_MIN_SEND_INTERVAL_MS - elapsed));
  }
  lastSendAt = Date.now();
  return client.sendMessage(chatId, text);
}

/** Persiste mensagens enviadas pelo celular (mesmo número conectado) para aparecer no Inbox.
 * Cria contato e conversa se não existirem, para que threads iniciadas pelo celular apareçam. */
async function processOutboundMessageFromDevice(msg: Message) {
  if (!msg.fromMe || !isDirectUserChat(msg.to)) return;

  const organizationId = DEFAULT_ORGANIZATION_ID;
  const toPhone = chatIdToPhone(msg.to);

  const chatId = msg.to;
  const fromBot = recentBotSends.has(chatId);
  if (fromBot) recentBotSends.delete(chatId);

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    toPhone,
    "Contato",
  );

  const body = (msg.body || "").trim() || "[mídia]";

  // Nunca alterar status de conversa encerrada para em_atendimento (ex: mensagem de pesquisa de satisfação).
  // Só muda status para em_atendimento se for mensagem real do atendente (não bot, não nova, não encerrada).
  const conversationEncerrada = conversation.status === "encerrado";
  const skipStatusUpdate = conversation.isNew || fromBot || conversationEncerrada;

  const message = await addOutboundMessage(
    organizationId,
    conversation.id,
    body,
    msg.id?.id,
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

async function handleInboundViaBotTriagem(msg: Message) {
  let fromPhone = chatIdToPhone(msg.from);
  let contactName = "Cliente";
  try {
    const contact = await msg.getContact();
    contactName = contact?.pushname || contact?.name || "Cliente";
    const contactNumber = String((contact as { number?: string }).number || "").replace(/\D/g, "");
    if (contactNumber.length >= 10) {
      fromPhone = `whatsapp:+${contactNumber}`;
    }
  } catch {
    // ignore
  }

  let inboundText = (msg.body || "").trim();
  let mediaUrl: string | undefined;
  let mimeType: string | undefined;
  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media?.data) {
        mimeType = media.mimetype || undefined;
        const uploaded = await uploadBase64ToCloudinary(media.data, mimeType || null);
        mediaUrl = uploaded?.secure_url || undefined;
      }
      if (!inboundText) {
        inboundText = mimeType?.startsWith("image/") ? "[imagem]" : "[midia]";
      }
    } catch (err) {
      logger.warn(
        { err, from: msg.from, id: msg.id?.id },
        "Failed to process inbound media for ticket-upsert",
      );
      if (!inboundText) inboundText = "[midia]";
    }
  }

  if (!inboundText) inboundText = "[sem_texto]";

  const result = await invokeTicketUpsertLocal({
    event_id: msg.id?.id || `wa-${Date.now()}`,
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
        event_id: msg.id?.id,
        defaultOrgId: DEFAULT_ORGANIZATION_ID,
      },
      "ticket-upsert local failed — WhatsApp may reply but inbox will not update until fixed (check WILLTALK_WEBHOOK_TOKEN, WILLTALK_INTERNAL_BASE_URL/PORT, DEFAULT_ORG_ID vs user organization)",
    );
  }
}

async function processInboundMessage(client: Client, msg: Message) {
  if (msg.fromMe || !isDirectUserChat(msg.from)) return;
  if (shouldIgnoreInboundWhatsApp(msg)) return;

  // Ignora mensagens enfileiradas que chegaram enquanto o WhatsApp estava desconectado.
  // Quando o cliente reconecta, o whatsapp-web.js dispara "message" para todo histórico
  // pendente — sem este filtro, o bot responderia a todos sem motivo.
  if (clientReadyAt !== null && typeof msg.timestamp === "number" && msg.timestamp < clientReadyAt) {
    logger.debug(
      { from: msg.from, msgTs: msg.timestamp, readyAt: clientReadyAt },
      "Skipping pre-connection queued message",
    );
    return;
  }

  const hasContent = Boolean((msg.body || "").trim()) || Boolean(msg.hasMedia);
  if (!hasContent) {
    logger.debug({ from: msg.from, type: msg.type }, "Ignoring inbound with no body and no media");
    return;
  }

  const n8nOnlyMode = String(process.env.WILLTALK_N8N_ONLY || "").toLowerCase() === "true";
  const aiTriageOnlyMode = String(process.env.WILLTALK_AI_TRIAGE_ONLY || "true").toLowerCase() !== "false";
  if (n8nOnlyMode || aiTriageOnlyMode) {
    await handleInboundViaBotTriagem(msg);
    return;
  }

  const organizationId = DEFAULT_ORGANIZATION_ID;
  const externalId = msg.id?.id;
  if (externalId) {
    try {
      const existing = await findMessageByExternalId(organizationId, externalId);
      if (existing) return;
    } catch (err) {
      logger.warn({ err, organizationId }, "Error checking duplicate message by externalId, processing as new");
    }
  }

  let fromPhone = chatIdToPhone(msg.from);
  const body = (msg.body || "").trim();

  let profileName = "Cliente";
  let avatarUrl: string | null = null;
  const raw = (msg as { _data?: { notifyName?: string } })._data;
  if (raw?.notifyName && String(raw.notifyName).trim()) profileName = String(raw.notifyName).trim();
  try {
    const waContact = await msg.getContact();
    const c = waContact as {
      pushname?: string;
      name?: string;
      shortName?: string;
      formattedName?: string;
      number?: string;
      getProfilePicUrl?: () => Promise<string | null>;
    };
    const push = c.pushname && String(c.pushname).trim();
    const name = c.name && String(c.name).trim();
    const shortName = c.shortName && String(c.shortName).trim();
    const formattedName = c.formattedName && String(c.formattedName).trim();
    if (profileName === "Cliente") {
      if (push) profileName = push;
      else if (name) profileName = name;
      else if (shortName) profileName = shortName;
      else if (formattedName) profileName = formattedName;
    }
    if (typeof c.getProfilePicUrl === "function") {
      try {
        const pic = await c.getProfilePicUrl();
        if (pic) avatarUrl = String(pic);
      } catch {
        // ignore avatar errors
      }
    }
    const contactNumber = String(c.number || "").replace(/\D/g, "");
    if (contactNumber.length >= 10) {
      fromPhone = `whatsapp:+${contactNumber}`;
    }
  } catch {
    // keep defaults if getContact fails
  }

  const businessRouting = await routeBusinessWhatsappMessage({
    organizationId,
    phone: fromPhone,
    message: body || (msg.hasMedia ? "[mídia]" : ""),
    conversationReference: externalId,
  });
  if (businessRouting.destination === "business") {
    if (businessRouting.reply) {
      await rateLimitedSend(
        client,
        msg.from,
        businessRouting.reply,
        true,
      );
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

  if (msg.hasMedia) {
    const media = await msg.downloadMedia();
    if (media) {
      mimeType = media.mimetype || null;
      type = mimeType?.startsWith("audio/")
        ? "audio"
        : mimeType?.startsWith("image/")
          ? "image"
          : "document";
      try {
        const upload = await uploadBase64ToCloudinary(media.data, mimeType);
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
    externalId: msg.id.id,
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
          client,
          msg.from,
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
      await rateLimitedSend(client, msg.from, `${reply}${outOfHoursSuffix}`, true);
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
        client,
        msg.from,
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

      await rateLimitedSend(client, msg.from, buildInvestigationPrompt(String(queue.name)), true);
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
        client,
        msg.from,
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

    await rateLimitedSend(client, msg.from, `${menu}\n\nTentativa ${nextAttempts}/3.${outOfHoursSuffix}`, true);
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

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: process.env.WHATSAPP_SESSION_NAME || "mavo-talk",
      dataPath: process.env.WHATSAPP_AUTH_PATH || ".wwebjs_auth",
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--no-first-run",
      ],
    },
  });

  client.on("qr", async (qr) => {
    state.status = "qr";
    state.qrDataUrl = await qrcode.toDataURL(qr);
  });

  client.on("ready", async () => {
    state.status = "ready";
    state.qrDataUrl = null;
    state.connectedPhone = client.info?.wid?.user ? `+${client.info.wid.user}` : null;
    clientReadyAt = Math.floor(Date.now() / 1000);
  });

  client.on("auth_failure", (error) => {
    state.status = "error";
    state.lastError = String(error);
  });

  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    state.lastError = String(reason);
    state.connectedPhone = null;
    clientReadyAt = null;
    global.__waClient = undefined;
  });

  client.on("message", (msg) => {
    if (msg.fromMe) return;
    void processInboundMessage(client, msg).catch((error) => {
      logger.error({ err: error }, "Failed to process inbound WhatsApp message");
    });
  });

  client.on("message_create", (msg) => {
    if (!msg.fromMe) return;
    if (!isDirectUserChat(msg.to || "")) return;
    if (shouldIgnoreInboundWhatsApp(msg)) return;
    void processOutboundMessageFromDevice(msg).catch((error) => {
      logger.error({ err: error }, "Failed to process outbound WhatsApp message (message_create)");
    });
  });

  const initPromise = (async () => {
    try {
      await client.initialize();
      global.__waClient = client;
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
      await global.__waClient.destroy();
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
  const client = global.__waClient;
  if (!client || getState().status !== "ready") return;

  try {
    const chatId = phoneToChatId(contactPhone);
    const chat = await client.getChatById(chatId);
    await chat.sendStateTyping();
  } catch {
    // ignora erro (ex: chat não encontrado)
  }
}

/** Envio via whatsapp-web.js (QR). Triagem/bot e `fromBot` usam apenas este caminho.
 * Mensagens do atendente pelo painel com Twilio continuam em `conversations/[id]/messages`. */
export async function sendWhatsappMessage(
  toPhone: string,
  text: string,
  options?: { skipRateLimit?: boolean; mediaUrl?: string; fromBot?: boolean },
) {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    throw new Error(
      "Triagem e envios automaticos usam whatsapp-web.js. Defina WHATSAPP_PROVIDER=unofficial e conecte o QR no painel.",
    );
  }

  const client = global.__waClient;
  if (!client) {
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

  const chatId = phoneToChatId(toPhone);

  // Marca como envio de bot ANTES de enviar, para que o evento message_create
  // gerado pelo whatsapp-web.js seja reconhecido como automático.
  if (options?.fromBot) {
    recentBotSends.add(chatId);
  }

  if (options?.mediaUrl) {
    const { MessageMedia } = await import("whatsapp-web.js");
    const media = await MessageMedia.fromUrl(options.mediaUrl);
    const sent = await client.sendMessage(chatId, media, { caption: text || undefined });
    return sent.id.id;
  }

  const sent =
    options?.skipRateLimit === true
      ? await client.sendMessage(chatId, text)
      : await rateLimitedSend(client, chatId, text);
  return sent.id.id;
}

const TRIAGE_READY_WAIT_MS = Number(process.env.WILLTALK_TRIAGE_READY_WAIT_MS) || 12_000;

/**
 * Triagem (ticket-upsert): tenta whatsapp-web.js com init + espera; se falhar ou não estiver pronto,
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

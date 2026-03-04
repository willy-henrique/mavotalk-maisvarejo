import qrcode from "qrcode";
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
  recordSatisfactionRatingByPhone,
} from "@/lib/repo";
import { logger } from "@/lib/logger";
import { emitRealtime } from "@/lib/realtime";
import { DEFAULT_ORGANIZATION_ID, buildDemandMenu } from "@/lib/utils";

type WhatsappStatus = "idle" | "initializing" | "qr" | "ready" | "disconnected" | "error";

type WhatsappState = {
  status: WhatsappStatus;
  qrDataUrl: string | null;
  lastError: string | null;
  connectedPhone: string | null;
};

declare global {
  var __waClient: Client | undefined;
  var __waState: WhatsappState | undefined;
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
  const digits = chatId.replace("@c.us", "").replace(/\D/g, "");
  return `whatsapp:+${digits}`;
}

function phoneToChatId(phone: string) {
  const digits = phone.replace("whatsapp:", "").replace(/\D/g, "");
  return `${digits}@c.us`;
}

/** Intervalo mínimo entre envios (ms) para respeitar limites do WhatsApp e reduzir risco de ban. */
const WA_MIN_SEND_INTERVAL_MS = Number(process.env.WA_MIN_SEND_INTERVAL_MS) || 1500;
let lastSendAt = 0;

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
  if (!msg.fromMe || !msg.to.endsWith("@c.us")) return;

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

  emitRealtime("message.created", { conversationId: conversation.id, message });
  emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: conversation.id,
    status,
  });
}

async function processInboundMessage(client: Client, msg: Message) {
  if (msg.fromMe || !msg.from.endsWith("@c.us")) return;

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

  const fromPhone = chatIdToPhone(msg.from);
  const body = (msg.body || "").trim();

  // 0) Tenta capturar nota de satisfação (1–5) para atendimentos encerrados.
  try {
    const recorded = await recordSatisfactionRatingByPhone(organizationId, fromPhone, body);
    if (recorded) {
      // Opcional: agradece e não cria/abre ticket.
      await rateLimitedSend(
        client,
        msg.from,
        "Obrigado pela sua avaliação! Sua opinião nos ajuda a melhorar o atendimento.",
        true,
      );
      return;
    }
  } catch (err) {
    logger.warn({ err, organizationId, fromPhone }, "Failed to record satisfaction rating; continuing flow");
  }

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
  } catch {
    // keep defaults if getContact fails
  }

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    fromPhone,
    profileName,
  );

  if (avatarUrl) {
    void updateContactAvatar(contact.id, avatarUrl).catch((err) => {
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

  emitRealtime("message.created", { conversationId: conversation.id, message: inbound });

  const queues = (await listQueues(organizationId)).filter((q) => q.isActive !== false);

  const businessOpen = await isOpenBusinessHour(new Date(), organizationId);
  const outOfHoursSuffix = businessOpen
    ? ""
    : "\n\nEstamos fora do horario comercial no momento. Seu chamado foi registrado e responderemos no proximo expediente.";

  if (!conversation.triageCompleted) {
    const selectedOption = Number.parseInt(body, 10);
    const queue = queues.find((item) => Number(item.menuOption) === selectedOption);

    if (queues.length === 0) {
      await updateConversationById(String(conversation.id), {
        triageCompleted: true,
        status: "aguardando",
      });
      emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
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

      await updateConversationById(String(conversation.id), {
        queueId: String(queue.id),
        triageCompleted: true,
        status: "aguardando",
      });

      await updateTicketByConversation(organizationId, String(conversation.id), {
        queueId: String(queue.id),
        firstResponseDueAt: dueAt,
      });

      emitRealtime("conversation.updated", {
        id: String(conversation.id),
        queueId: String(queue.id),
        status: "aguardando",
      });

      await rateLimitedSend(client, msg.from, `Demanda *${String(queue.name)}* registrada. Seu chamado esta na fila de atendimento.${outOfHoursSuffix}`, true);
      return;
    }

    const nextAttempts = Number(conversation.menuAttempts || 0) + 1;

    if (nextAttempts >= 3) {
      await updateConversationById(String(conversation.id), {
        triageCompleted: true,
        menuAttempts: nextAttempts,
        status: "aguardando",
      });

      emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
        id: String(conversation.id),
        status: "aguardando",
      });

      await rateLimitedSend(
        client,
        msg.from,
        `Nao consegui identificar a opcao selecionada. Seu chamado foi encaminhado para atendimento humano.${outOfHoursSuffix}`,
        true,
      );
      return;
    }

    await updateConversationById(String(conversation.id), {
      menuAttempts: nextAttempts,
    });

    const menu = buildDemandMenu(
      queues.map((q) => ({
        menuOption: Number(q.menuOption),
        name: String(q.name),
      })),
    );

    await rateLimitedSend(client, msg.from, `${menu}\n\nTentativa ${nextAttempts}/3.${outOfHoursSuffix}`, true);
    return;
  }

  // Se estava encerrado, reabre como aguardando (sem enviar mensagem automática — evita spawn).
  const wasClosed = conversation.status === "encerrado";
  const newStatus = wasClosed ? "aguardando" : conversation.status;

  await updateConversationById(String(conversation.id), { status: newStatus });

  emitRealtime(conversation.isNew ? "conversation.created" : "conversation.updated", {
    id: String(conversation.id),
    status: newStatus,
  });

  // Nenhuma mensagem automática pós-triagem: o atendente responde pelo painel.
}

export function getWhatsappState() {
  return getState();
}

export async function initWhatsappClient() {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    return getState();
  }

  if (global.__waClient) {
    return getState();
  }

  const state = getState();
  state.status = "initializing";
  state.lastError = null;

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: process.env.WHATSAPP_SESSION_NAME || "willtalk" }),
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
  });

  client.on("auth_failure", (error) => {
    state.status = "error";
    state.lastError = String(error);
  });

  client.on("disconnected", (reason) => {
    state.status = "disconnected";
    state.lastError = String(reason);
  });

  client.on("message", (msg) => {
    if (msg.fromMe) {
      void processOutboundMessageFromDevice(msg).catch((error) => {
        logger.error({ err: error }, "Failed to process outbound WhatsApp message");
      });
    } else {
      void processInboundMessage(client, msg).catch((error) => {
        logger.error({ err: error }, "Failed to process inbound WhatsApp message");
      });
    }
  });

  // Mensagens enviadas pelo celular (mesmo número) chegam por message_create, não por message.
  client.on("message_create", (msg) => {
    if (msg.fromMe && !msg.to.endsWith("@c.us")) return;
    if (msg.fromMe) {
      void processOutboundMessageFromDevice(msg).catch((error) => {
        logger.error({ err: error }, "Failed to process outbound WhatsApp message (message_create)");
      });
    }
  });

  await client.initialize();
  global.__waClient = client;

  return state;
}

export async function destroyWhatsappClient() {
  if (!global.__waClient) return;
  await global.__waClient.destroy();
  global.__waClient = undefined;
  const state = getState();
  state.status = "disconnected";
  state.qrDataUrl = null;
  state.connectedPhone = null;
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

/** Envia mensagem pelo WhatsApp. skipRateLimit: true para envio pelo painel (sem esperar intervalo). mediaUrl opcional para imagem.
 * fromBot: true marca como mensagem automática, evitando que processOutboundMessageFromDevice reabra a conversa. */
export async function sendWhatsappMessage(
  toPhone: string,
  text: string,
  options?: { skipRateLimit?: boolean; mediaUrl?: string; fromBot?: boolean },
) {
  const client = global.__waClient;
  if (!client) {
    throw new Error("WhatsApp client nao inicializado");
  }

  const state = getState();
  if (state.status !== "ready") {
    throw new Error("WhatsApp client ainda nao esta pronto");
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

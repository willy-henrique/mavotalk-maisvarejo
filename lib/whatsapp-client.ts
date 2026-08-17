import qrcode from "qrcode";
import twilio from "twilio";
import makeWASocket, {
  fetchLatestBaileysVersion,
  downloadMediaMessage,
  getContentType,
  normalizeMessageContent,
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
  isContactBlocked,
  updateConversationById,
  updateTicketByConversation,
  updateWhatsappContactAvatarsByPhone,
  recordSatisfactionRatingByPhone,
  upsertWhatsappDirectoryEntries,
  findWhatsappDirectoryName,
  importWhatsappContacts,
  deleteImportedWhatsappContacts,
  clearWhatsappDirectory,
} from "@/lib/repo";
import { logger } from "@/lib/logger";
import { emitRealtime } from "@/lib/realtime";
import { invokeTicketUpsertLocal } from "@/lib/n8n-ticket-upsert-client";
import {
  buildInvestigationAiReply,
  buildQuickGuidance,
  INVESTIGATION_AI_ROUNDS,
} from "@/lib/investigation-reply";
import {
  DEFAULT_ORGANIZATION_ID,
  buildDemandMenu,
  toWhatsAppAddress,
  whatsappPhoneCandidates,
} from "@/lib/utils";
import { sendWillTalkWebhook } from "@/lib/willtalk-webhook";
import { routeBusinessWhatsappMessage } from "@/lib/business-access/business-whatsapp-router";
import {
  isDirectUserJid,
  resolvePhoneJid,
  whatsappPhoneFromJid,
} from "@/lib/whatsapp-addressing";
import {
  configuredWhatsappAuthPersistence,
  configuredWhatsappAuthStore,
  shouldAutoReconnectWhatsapp,
} from "@/lib/whatsapp-auth-config";
import {
  createWhatsappAuthState,
  type WhatsappAuthStateHandle,
} from "@/lib/whatsapp-auth-state";
import {
  classifyWhatsappInitializationError,
  type WhatsappDiagnosticCode,
  type WhatsappInitializationStage,
} from "@/lib/whatsapp-diagnostics";
import {
  syncWhatsappContactAvatars,
  type WhatsappAvatarSyncResult,
  type WhatsappAvatarTarget,
} from "@/lib/whatsapp-contact-avatars";

type WhatsappStatus = "idle" | "initializing" | "qr" | "ready" | "disconnected" | "error";

type WhatsappState = {
  status: WhatsappStatus;
  qrDataUrl: string | null;
  /** Código de pareamento por telefone, alternativa ao QR quando não há câmera utilizável. */
  pairingCode: string | null;
  pairingPhone: string | null;
  pairingCodeIssuedAt: string | null;
  pairingCodeExpiresAt: string | null;
  /** Diagnóstico da última falha de pareamento. Separado de `lastError` porque o
   * auto-reconnect zera aquele campo poucos segundos depois, justamente enquanto o
   * operador ainda está lendo a tela. */
  lastPairingFailure: string | null;
  lastError: string | null;
  connectedPhone: string | null;
  authStore: "database" | "filesystem";
  sessionPersistent: boolean;
  authPersistenceHealthy: boolean;
  initializationStage: WhatsappInitializationStage | null;
  diagnosticCode: WhatsappDiagnosticCode | null;
};

type KnownError = { message?: string };

declare global {
  var __waClient: WASocket | undefined;
  var __waState: WhatsappState | undefined;
  var __waInitPromise: Promise<WhatsappState> | undefined;
  var __waDestroyPromise: Promise<void> | undefined;
  var __waUnhandledRejectionHooked: boolean | undefined;
  var __waManualDisconnect: boolean | undefined;
  var __waReconnectTimer: NodeJS.Timeout | undefined;
  var __waAuthResetPromise: Promise<void> | undefined;
  var __waAuthHandle: WhatsappAuthStateHandle | undefined;
  var __waGeneration: number | undefined;
}

/** Geração do socket ativo. Cada init cria uma nova geração e cada destroy a invalida,
 * para que callbacks de um socket antigo (em especial `creds.update`) não voltem a
 * gravar credenciais já removidas e ressuscitem a sessão anterior. */
function currentWhatsappGeneration(): number {
  if (typeof global.__waGeneration !== "number") global.__waGeneration = 0;
  return global.__waGeneration;
}

function nextWhatsappGeneration(): number {
  global.__waGeneration = currentWhatsappGeneration() + 1;
  return global.__waGeneration;
}

function whatsappAuthStateOptions() {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    sessionName: process.env.WHATSAPP_SESSION_NAME || "mavo-talk-production",
    authPath: process.env.WHATSAPP_AUTH_PATH,
    diskPath: process.env.RENDER_DISK_PATH,
  };
}

/** Remove a sessão persistida (banco ou disco) para que o próximo init gere um QR novo.
 * Sem isso, `initWhatsappClient` recarrega credenciais ainda registradas e o Baileys
 * reconecta silenciosamente no mesmo número, sem nunca emitir o evento `qr`. */
async function clearWhatsappAuthState(): Promise<void> {
  const pending = global.__waAuthResetPromise;
  const handle = global.__waAuthHandle;
  global.__waAuthHandle = undefined;

  const reset = (async () => {
    if (pending) await pending.catch(() => undefined);
    // Após um restart do processo o handle em memória não existe mais; recriá-lo
    // garante que o disconnect continue limpando a sessão persistida.
    const target = handle || (await createWhatsappAuthState(whatsappAuthStateOptions()));
    await target.clearSession();
  })();

  global.__waAuthResetPromise = reset;
  try {
    await reset;
    getState().authPersistenceHealthy = true;
  } finally {
    if (global.__waAuthResetPromise === reset) {
      global.__waAuthResetPromise = undefined;
    }
  }
}

function clearPairingCode(state: WhatsappState) {
  state.pairingCode = null;
  state.pairingPhone = null;
  state.pairingCodeIssuedAt = null;
  state.pairingCodeExpiresAt = null;
  pairingRequestedGeneration = null;
}

/** Sincronização completa de histórico. Desligada por padrão pelo custo de memória. */
const WA_SYNC_FULL_HISTORY =
  String(process.env.WHATSAPP_SYNC_FULL_HISTORY || "false").toLowerCase() === "true";

/** Tempo de vida de cada ref de QR. O padrão do Baileys (20s a partir do segundo ref)
 * esgota a lista e derruba o socket em ~2min, curto demais para digitar o código. */
const WA_QR_TIMEOUT_MS = Number(process.env.WA_QR_TIMEOUT_MS) || 60_000;

/** No pareamento por número ninguém olha o QR: o ciclo de refs serve apenas para manter
 * o socket vivo, e cada ref estica a janela.
 *
 * Fica em 60s porque é o valor que o próprio Baileys usa no primeiro ref — o único
 * que dá para tratar como tolerado pelo servidor. Esticar mais era palpite meu, sem
 * como validar se o WhatsApp aceita segurar um ref tanto tempo. Ajustável por env
 * caso os logs mostrem que dá folga. */
const WA_PAIRING_QR_TIMEOUT_MS =
  Number(process.env.WA_PAIRING_QR_TIMEOUT_MS) || 60_000;

/** Rede de segurança para o código não ficar exibido eternamente se algo travar.
 * O sinal real de morte do código é o fechamento do socket que o emitiu — tratado
 * em `connection.update`, já que o pareamento só vale enquanto aquele socket vive. */
const WA_PAIRING_CODE_TTL_MS = Number(process.env.WA_PAIRING_CODE_TTL_MS) || 600_000;

/** Tempo máximo esperando o socket ficar apto a pedir o código (conectado e não registrado). */
const WA_PAIRING_SOCKET_WAIT_MS = Number(process.env.WA_PAIRING_SOCKET_WAIT_MS) || 25_000;

/** `logout()` fica pendente para sempre se o socket já caiu; sem teto o disconnect trava. */
const WA_LOGOUT_TIMEOUT_MS = Number(process.env.WA_LOGOUT_TIMEOUT_MS) || 8_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} excedeu ${ms}ms`)), ms);
        timer.unref();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function getState(): WhatsappState {
  if (!global.__waState) {
    global.__waState = {
      status: "idle",
      qrDataUrl: null,
      pairingCode: null,
      pairingPhone: null,
      pairingCodeIssuedAt: null,
      pairingCodeExpiresAt: null,
      lastPairingFailure: null,
      lastError: null,
      connectedPhone: null,
      authStore: configuredWhatsappAuthStore(),
      sessionPersistent: configuredWhatsappAuthPersistence(),
      authPersistenceHealthy: true,
      initializationStage: null,
      diagnosticCode: null,
    };
  }
  return global.__waState;
}

function phoneToChatId(phone: string) {
  const digits = whatsappPhoneCandidates(phone)[0] || "";
  return `${digits}@s.whatsapp.net`;
}

const WA_CONTACT_AVATAR_CONCURRENCY = Math.max(
  1,
  Math.min(6, Number(process.env.WA_CONTACT_AVATAR_CONCURRENCY) || 3),
);
const WA_CONTACT_AVATAR_TIMEOUT_MS = Math.max(
  500,
  Math.min(30_000, Number(process.env.WA_CONTACT_AVATAR_TIMEOUT_MS) || 6_000),
);
const WA_CONTACT_AVATAR_REFRESH_MS = Math.max(
  60_000,
  Number(process.env.WA_CONTACT_AVATAR_REFRESH_MS) || 24 * 60 * 60 * 1000,
);

const queuedAvatarPhones = new Set<string>();
const recentlySyncedAvatarAt = new Map<string, number>();
let contactAvatarSyncTail: Promise<void> = Promise.resolve();
let lastContactAvatarSync: WhatsappAvatarSyncResult & { completedAt: string | null } = {
  requested: 0,
  found: 0,
  saved: 0,
  unavailable: 0,
  completedAt: null,
};

function scheduleWhatsappContactAvatarSync(
  sock: WASocket,
  targets: WhatsappAvatarTarget[],
  source: string,
) {
  const now = Date.now();
  const unique = new Map<string, WhatsappAvatarTarget>();
  for (const target of targets) {
    const lastAttempt = recentlySyncedAvatarAt.get(target.phoneNumber) || 0;
    if (
      queuedAvatarPhones.has(target.phoneNumber) ||
      now - lastAttempt < WA_CONTACT_AVATAR_REFRESH_MS
    ) {
      continue;
    }
    unique.set(target.phoneNumber, target);
  }
  const scheduled = [...unique.values()];
  if (!scheduled.length) return;
  for (const target of scheduled) queuedAvatarPhones.add(target.phoneNumber);

  const run = async () => {
    let completed = false;
    try {
      const result = await syncWhatsappContactAvatars({
        targets: scheduled,
        profilePictureUrl: (jid) => sock.profilePictureUrl(jid, "image"),
        persist: (updates) =>
          updateWhatsappContactAvatarsByPhone(DEFAULT_ORGANIZATION_ID, updates),
        concurrency: WA_CONTACT_AVATAR_CONCURRENCY,
        timeoutMs: WA_CONTACT_AVATAR_TIMEOUT_MS,
      });
      lastContactAvatarSync = {
        ...result,
        completedAt: new Date().toISOString(),
      };
      completed = true;
      logger.info({ source, ...result }, "WhatsApp contact avatars synchronized");
    } catch (err) {
      logger.warn({ err, source, requested: scheduled.length }, "Failed to sync WhatsApp contact avatars");
    } finally {
      const attemptedAt = Date.now();
      for (const target of scheduled) {
        queuedAvatarPhones.delete(target.phoneNumber);
        // Falha de banco/rede deve poder ser tentada novamente no próximo evento.
        if (completed) recentlySyncedAvatarAt.set(target.phoneNumber, attemptedAt);
      }
      if (recentlySyncedAvatarAt.size > 20_000) {
        const cutoff = attemptedAt - WA_CONTACT_AVATAR_REFRESH_MS;
        for (const [phoneNumber, syncedAt] of recentlySyncedAvatarAt) {
          if (syncedAt < cutoff) recentlySyncedAvatarAt.delete(phoneNumber);
        }
      }
    }
  };

  contactAvatarSyncTail = contactAvatarSyncTail.then(run, run);
}

export function getWhatsappContactAvatarSyncStatus() {
  return {
    ...lastContactAvatarSync,
    pending: queuedAvatarPhones.size,
  };
}

export async function waitForWhatsappContactAvatarSync(timeoutMs = 3_000) {
  const currentBatch = contactAvatarSyncTail;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      currentBatch,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  return getWhatsappContactAvatarSyncStatus();
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

/**
 * Conteúdo real da mensagem.
 *
 * O WhatsApp encapsula o conteúdo em `ephemeralMessage` (mensagens temporárias),
 * `viewOnceMessage` e `documentWithCaptionMessage`. Lendo `message.imageMessage`
 * direto, uma foto enviada nesses formatos não era reconhecida como mídia nem como
 * texto: a mensagem ficava sem conteúdo e era descartada em silêncio.
 */
function messageContent(message: proto.IMessage | null | undefined) {
  if (!message) return null;
  return normalizeMessageContent(message) || message;
}

/** Evita processar status, broadcast, notificações de sistema e ruído que não é conversa 1:1 real. */
function shouldIgnoreInboundWhatsApp(msg: WAMessage): boolean {
  if (msg.broadcast) return true;
  const jid = String(msg.key?.remoteJid || "");
  if (jid === "status@broadcast" || /@broadcast$/i.test(jid)) return true;
  if (msg.messageStubType) return true;
  const contentType = getContentType(messageContent(msg.message) || undefined);
  if (!contentType || WA_IGNORE_CONTENT_TYPES.has(contentType)) return true;
  return false;
}

function extractMessageText(raw: proto.IMessage | null | undefined): string {
  const message = messageContent(raw);
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

function detectInboundMedia(raw: proto.IMessage | null | undefined): {
  kind: InboundMediaKind;
  mimeType?: string;
} {
  const message = messageContent(raw);
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
  sock?: WASocket,
): Promise<{ base64: string; mimeType?: string } | null> {
  try {
    // `reuploadRequest` permite pedir ao WhatsApp que reenvie a mídia quando o link
    // original já expirou. Sem esse contexto o download falhava de vez, o que é
    // provável na instância gratuita: ela hiberna e o processamento atrasa.
    const buffer = await downloadMediaMessage(
      msg,
      "buffer",
      {},
      sock ? { reuploadRequest: sock.updateMediaMessage, logger } : undefined,
    );
    if (buffer.byteLength > 16 * 1024 * 1024) {
      logger.warn(
        { id: msg.key?.id, sizeBytes: buffer.byteLength },
        "Ignoring inbound WhatsApp media above 16 MB",
      );
      return null;
    }
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

/** Ordena as renderizações assíncronas de QR para que a última emitida sempre vença. */
let qrSequence = 0;

/** Geração do socket que já emitiu um código de pareamento. O ciclo de refs de QR do
 * Baileys continua rodando depois do pedido e reescreveria o QR na tela, oferecendo ao
 * operador um caminho que não é o que está em andamento. */
let pairingRequestedGeneration: number | null = null;

/** Timestamp Unix (segundos) do momento em que o cliente ficou pronto.
 * Mensagens com timestamp anterior a este valor são mensagens offline enfileiradas
 * e são recuperadas sem disparar respostas automáticas atrasadas. */
let clientReadyAt: number | null = null;
const WA_QUEUED_MESSAGE_RECOVERY_MAX_AGE_SECONDS = Math.max(
  60,
  Number(process.env.WA_QUEUED_MESSAGE_RECOVERY_MAX_AGE_SECONDS) ||
    7 * 24 * 60 * 60,
);

/** Preserva a ordem de mensagens de um lote `append`/`notify` e evita que duas
 * primeiras mensagens criem/atualizem a mesma conversa em paralelo. */
let whatsappMessageProcessingTail: Promise<void> = Promise.resolve();

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

  // Qualquer resposta escrita por uma pessoa encerra a triagem, inclusive quando vem
  // do próprio WhatsApp em vez do painel. Antes só cobríamos a conversa aberta pela
  // loja, então o atendente que respondia pelo aplicativo não desligava o bot — e o
  // cliente recebia o menu de boas-vindas por cima de uma conversa humana já em curso.
  //
  // É gravado antes de persistir a mensagem: o bot ainda pode estar processando a
  // mensagem anterior do cliente, e é este registro que faz a checagem dele desistir.
  if (!fromBot && conversation.status !== "encerrado") {
    await updateConversationById(organizationId, String(conversation.id), {
      triageCompleted: true,
      ...(conversation.isNew ? {} : { status: "em_atendimento" }),
    }).catch((err) => {
      logger.warn(
        { err, conversationId: conversation.id },
        "Failed to end triage after a human reply",
      );
    });
  }

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
  options?: { suppressReply?: boolean },
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
    if (!options?.suppressReply) {
      await rateLimitedSend(
        sock,
        remoteJid,
        "Não consegui iniciar o atendimento automático agora. Por favor, tente novamente em instantes.",
        true,
      );
    }
    return;
  }
  // O nome salvo pela loja vale mais que o pushName: é ele que identifica o cliente
  // recorrente para quem atende.
  const directoryName = await findWhatsappDirectoryName(
    DEFAULT_ORGANIZATION_ID,
    fromPhone,
  ).catch(() => null);
  const contactName = directoryName || msg.pushName || "Cliente";

  let inboundText = extractMessageText(msg.message);
  let mediaUrl: string | undefined;
  let mimeType: string | undefined;
  const { kind } = detectInboundMedia(msg.message);
  if (kind) {
    const downloaded = await downloadInboundMedia(msg, sock);
    if (downloaded) {
      mimeType = downloaded.mimeType;
      try {
        const uploaded = await uploadBase64ToCloudinary(downloaded.base64, mimeType || null);
        mediaUrl = uploaded?.secure_url || undefined;
        if (!uploaded) {
          logger.error(
            { from: remoteJid, id: msg.key?.id, kind },
            "Cloudinary não configurado: a mídia recebida não pôde ser armazenada",
          );
        }
      } catch (err) {
        logger.warn(
          { err, from: remoteJid, id: msg.key?.id },
          "Failed to process inbound media for ticket-upsert",
        );
      }
    } else {
      logger.warn(
        { from: remoteJid, id: msg.key?.id, kind },
        "Inbound media detected but download returned nothing",
      );
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
    metadata: {
      ingest_origin: "whatsapp-unofficial",
      ...(options?.suppressReply ? { suppress_reply: true } : {}),
    },
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
    if (!options?.suppressReply) {
      await rateLimitedSend(
        sock,
        remoteJid,
        "Não consegui concluir o atendimento automático agora. Por favor, tente novamente em instantes.",
        true,
      );
    }
    return;
  }

  // O ticket-upsert já criou/resolveu o contato. Buscar a foto depois dele evita
  // perder o UPDATE no modo de triagem usado atualmente no Render.
  scheduleWhatsappContactAvatarSync(
    sock,
    [{ phoneNumber: fromPhone, jid: phoneToChatId(fromPhone) }],
    "messages.upsert",
  );

  const decision = result.data as {
    shouldReply?: unknown;
    replyText?: unknown;
    replyDelivered?: unknown;
    conversationId?: unknown;
    organizationId?: unknown;
  };
  if (
    !options?.suppressReply &&
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

  // Mensagens que chegaram enquanto a Render estava dormindo reaparecem como
  // `append` após a reconexão. Elas precisam ser persistidas no Inbox, mas não podem
  // disparar uma sequência atrasada de respostas automáticas para o cliente.
  const messageTimestamp = Number(msg.messageTimestamp || 0);
  const isPreConnectionQueued =
    clientReadyAt !== null &&
    messageTimestamp > 0 &&
    messageTimestamp < clientReadyAt;
  if (isPreConnectionQueued) {
    const queuedAgeSeconds = clientReadyAt! - messageTimestamp;
    if (queuedAgeSeconds > WA_QUEUED_MESSAGE_RECOVERY_MAX_AGE_SECONDS) {
      logger.debug(
        {
          from: remoteJid,
          msgTs: messageTimestamp,
          readyAt: clientReadyAt,
          queuedAgeSeconds,
        },
        "Skipping historical WhatsApp message outside the recovery window",
      );
      return;
    }
    logger.info(
      {
        from: remoteJid,
        msgTs: messageTimestamp,
        readyAt: clientReadyAt,
        queuedAgeSeconds,
      },
      "Persisting pre-connection queued message without an automatic reply",
    );
  }

  const { kind: mediaKind } = detectInboundMedia(msg.message);
  const bodyRaw = extractMessageText(msg.message);
  const hasContent = Boolean(bodyRaw) || Boolean(mediaKind);
  if (!hasContent) {
    logger.debug({ from: remoteJid }, "Ignoring inbound with no body and no media");
    return;
  }

  // A resposta da pesquisa de satisfação precisa ser tratada antes de qualquer
  // triagem: seguindo adiante, o "5" vira uma mensagem comum, o ticket-upsert abre
  // um atendimento novo e o cliente recebe o menu de boas-vindas logo após avaliar.
  const ratingPhone = await resolveMessagePhone(sock, msg);
  if (ratingPhone && bodyRaw) {
    let rated = false;
    try {
      rated = await recordSatisfactionRatingByPhone(
        DEFAULT_ORGANIZATION_ID,
        ratingPhone,
        bodyRaw,
      );
    } catch (err) {
      logger.warn({ err, phone: ratingPhone }, "Failed to record satisfaction rating");
    }
    if (rated) {
      logger.info({ phone: ratingPhone, score: bodyRaw.trim() }, "Satisfaction rating recorded");
      if (!isPreConnectionQueued) {
        await rateLimitedSend(
          sock,
          remoteJid,
          "Obrigado pela sua avaliação! Se precisar de algo, é só chamar.",
          true,
        );
      }
      return;
    }
  }

  const n8nOnlyMode = String(process.env.WILLTALK_N8N_ONLY || "").toLowerCase() === "true";
  const aiTriageOnlyMode = String(process.env.WILLTALK_AI_TRIAGE_ONLY || "true").toLowerCase() !== "false";
  if (isPreConnectionQueued || n8nOnlyMode || aiTriageOnlyMode) {
    await handleInboundViaBotTriagem(sock, msg, {
      suppressReply: isPreConnectionQueued,
    });
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
  const savedName = await findWhatsappDirectoryName(organizationId, fromPhone).catch(() => null);
  const profileName = savedName || (msg.pushName || "").trim() || "Cliente";

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

  if (await isContactBlocked(organizationId, fromPhone)) {
    logger.info({ organizationId, phone: fromPhone }, "Ignored inbound message from blocked contact");
    return;
  }

  const { contact, conversation } = await getOrCreateContactAndOpenConversation(
    organizationId,
    fromPhone,
    profileName,
  );

  scheduleWhatsappContactAvatarSync(
    sock,
    [{ phoneNumber: fromPhone, jid: phoneToChatId(fromPhone) }],
    "messages.upsert",
  );

  let mediaUrl: string | null = null;
  let mimeType: string | null = null;
  let cloudinaryPublicId: string | null = null;
  let type: "text" | "image" | "document" | "audio" = "text";

  if (mediaKind) {
    const downloaded = await downloadInboundMedia(msg, sock);
    if (downloaded) {
      mimeType = downloaded.mimeType || null;
      type = mediaKind;
      try {
        const upload = await uploadBase64ToCloudinary(downloaded.base64, mimeType);
        mediaUrl = upload?.secure_url || null;
        cloudinaryPublicId = upload?.public_id || null;
        if (!upload) {
          // O upload devolve null, sem lançar, quando falta credencial do Cloudinary.
          // Era o caminho que transformava toda imagem em "[midia]" sem rastro algum.
          logger.error(
            { conversationId: conversation.id, mediaKind },
            "Cloudinary não configurado: a mídia recebida não pôde ser armazenada",
          );
        }
      } catch (err) {
        // Falha silenciosa aqui fazia a imagem do cliente sumir sem rastro: a mensagem
        // era gravada como "[midia]" e ninguém sabia que o upload tinha quebrado.
        logger.error(
          { err, conversationId: conversation.id, mediaKind, mimeType },
          "Failed to upload inbound media to Cloudinary",
        );
        mediaUrl = null;
      }
    } else {
      logger.warn(
        { conversationId: conversation.id, mediaKind, externalId: msg.key?.id },
        "Inbound media detected but download returned nothing",
      );
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

  // Conversas antigas podem estar em_atendimento com a triagem ainda aberta, de antes
  // de o "puxar atendimento" encerrá-la. Checar o status evita reenviar o menu nelas
  // sem precisar corrigir dados existentes.
  const humanHandling = conversation.status === "em_atendimento";

  if (!conversation.triageCompleted && !humanHandling) {
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

export function getPublicWhatsappStatus() {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  const state = getState();
  return {
    provider,
    status: state.status,
    ready: provider === "unofficial" ? state.status === "ready" : true,
    actionRequired:
      provider === "unofficial" &&
      (["qr", "disconnected", "error"].includes(state.status) ||
        !state.authPersistenceHealthy),
    authStore: state.authStore,
    sessionPersistent: state.sessionPersistent,
    authPersistenceHealthy: state.authPersistenceHealthy,
    initializationStage: state.initializationStage,
    diagnosticCode: state.diagnosticCode,
  };
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

export async function initWhatsappClient(options?: { pairingMode?: boolean }) {
  const pairingMode = options?.pairingMode === true;
  ensureUnhandledRejectionGuard();
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    return getState();
  }

  if (global.__waClient) {
    const current = getState();
    if (["ready", "qr", "initializing"].includes(current.status)) {
      return current;
    }
    // Socket órfão: a referência sobreviveu a um close que não a limpou.
    // Descarta antes de recriar, senão o init aborta e o painel trava no estado antigo.
    await destroyWhatsappClient();
  }

  if (global.__waInitPromise) {
    return global.__waInitPromise;
  }

  const state = getState();
  state.status = "initializing";
  state.lastError = null;
  // Nunca exibir o QR nem o código da tentativa anterior enquanto o novo não chega.
  state.qrDataUrl = null;
  clearPairingCode(state);
  state.initializationStage = "auth-store";
  state.diagnosticCode = null;
  if (state.authStore === "database") {
    state.authPersistenceHealthy = false;
  }
  global.__waManualDisconnect = false;
  if (global.__waReconnectTimer) {
    clearTimeout(global.__waReconnectTimer);
    global.__waReconnectTimer = undefined;
  }

  const initPromise = (async () => {
    try {
      if (global.__waAuthResetPromise) {
        const pendingReset = global.__waAuthResetPromise;
        try {
          await pendingReset;
        } finally {
          if (global.__waAuthResetPromise === pendingReset) {
            global.__waAuthResetPromise = undefined;
          }
        }
      }
      let auth = await createWhatsappAuthState(whatsappAuthStateOptions());

      // Sessão persistida de um pareamento por código que nunca concluiu: mantê-la
      // faria este socket entrar no ramo de login de um aparelho inexistente e
      // falhar indefinidamente. Descartar aqui recupera sozinho uma instalação que
      // já subiu com esse estado gravado, sem exigir um "Desconectar" manual.
      if (auth.state.creds.pairingCode && !auth.state.creds.registered) {
        logger.warn(
          "Discarding stored WhatsApp session left by an incomplete pairing attempt",
        );
        await auth.clearSession();
        auth = await createWhatsappAuthState(whatsappAuthStateOptions());
      }

      const { state: authState, saveCreds } = auth;
      global.__waAuthHandle = auth;
      const generation = nextWhatsappGeneration();
      state.authStore = auth.store;
      state.sessionPersistent = auth.persistent;
      state.authPersistenceHealthy = true;
      state.initializationStage = "version-lookup";
      const { version } = await fetchLatestBaileysVersion();

      state.initializationStage = "socket";
      const sock = makeWASocket({
        version,
        auth: authState,
        logger,
        // O WhatsApp só aceita pareamento por número de clientes web que reconhece:
        // getCompanionWebClientType mapeia apenas Chrome/Edge/Firefox/IE/Opera/Safari/
        // Desktop e joga todo o resto em OTHER_WEB_CLIENT. Passar WHATSAPP_SESSION_NAME
        // aqui nos anunciava como cliente desconhecido no link_code_companion_reg —
        // enquanto o nó de registro caía no fallback CHROME — e o código era recusado.
        // O nome da sessão identifica a sessão persistida, não o navegador.
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: false,
        // A agenda do aparelho chega pelo app state, e há indício de que a carga
        // completa só vem com o history sync ligado. Fica ajustável por env para
        // testar em produção sem novo deploy: ligado consome bem mais memória, o que
        // é sensível na instância gratuita do Render.
        syncFullHistory: WA_SYNC_FULL_HISTORY,
        // O Baileys consome uma lista finita de refs de QR e derruba o socket quando
        // ela acaba (Socket/socket.js: "QR refs attempts ended"). No padrão os refs
        // seguintes duram só 20s, o que fecha a conexão em ~2min — tempo curto demais
        // para alguém digitar o código de pareamento no celular.
        qrTimeout: pairingMode ? WA_PAIRING_QR_TIMEOUT_MS : WA_QR_TIMEOUT_MS,
      });

      sock.ev.on("creds.update", () => {
        // Um `creds.update` atrasado do socket anterior regravaria a sessão que o
        // disconnect acabou de apagar, e o número antigo voltaria no próximo QR.
        if (generation !== currentWhatsappGeneration()) return;
        void saveCreds()
          .then(() => {
            state.authPersistenceHealthy = true;
            if (
              state.lastError === "Falha ao persistir a sessão do WhatsApp"
            ) {
              state.lastError = null;
            }
          })
          .catch((error) => {
            state.authPersistenceHealthy = false;
            state.lastError = "Falha ao persistir a sessão do WhatsApp";
            logger.error(
              { err: error },
              "Failed to persist WhatsApp credentials",
            );
          });
      });

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (generation !== currentWhatsappGeneration()) return;

        if (qr) {
          state.status = "qr";
          // Pareamento por código em andamento: o QR que continua rotacionando não é o
          // caminho escolhido e, exibido junto, faz o operador achar que pode escanear.
          if (pairingRequestedGeneration === generation) {
            state.qrDataUrl = null;
            return;
          }
          const qrToken = ++qrSequence;
          void qrcode
            .toDataURL(qr)
            .then((url) => {
              // Descarta renderizações fora de ordem: um QR antigo resolvendo depois
              // do atual deixaria na tela um código já expirado.
              if (generation !== currentWhatsappGeneration() || qrToken !== qrSequence) return;
              state.qrDataUrl = url;
            })
            .catch((err) => {
              logger.warn({ err }, "Failed to render WhatsApp QR Code");
            });
        }

        if (connection === "open") {
          global.__waManualDisconnect = false;
          state.status = "ready";
          state.qrDataUrl = null;
          clearPairingCode(state);
          state.lastPairingFailure = null;
          state.lastError = null;
          const rawId = sock.user?.id || "";
          const digits = rawId.split(":")[0]?.split("@")[0] || "";
          state.connectedPhone = digits ? `+${digits}` : null;
          clientReadyAt = Math.floor(Date.now() / 1000);
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
          const loggedOut = statusCode === DisconnectReason.loggedOut;

          // `requestPairingCode` grava creds.me antes de o pareamento concluir. Se o
          // socket cair antes disso, sobra uma sessão com me preenchido e registered
          // false — e o Baileys decide registro vs. login por `if (!creds.me)`. Nesse
          // estado todo socket novo tenta LOGIN de um aparelho que nunca foi pareado,
          // e o cliente recebe "Não foi possível conectar o dispositivo" para sempre.
          //
          // O discriminador é `creds.pairingCode`, gravado só por requestPairingCode:
          // no fluxo por QR o pair-success também deixa me preenchido com registered
          // ainda false (o servidor pede restart antes de concluir), e usar me aqui
          // apagaria uma sessão recém-pareada com sucesso. O restart (515) fica fora
          // por definição — ele significa "reconecte com o que você já tem".
          const restartRequired = statusCode === DisconnectReason.restartRequired;
          const abandonedPairing =
            !restartRequired &&
            Boolean(authState.creds?.pairingCode) &&
            !authState.creds?.registered;

          // O WhatsApp recusa o pareamento com uma mensagem genérica no celular; o
          // motivo real só aparece no statusCode desta queda. Sem isso o diagnóstico
          // vira adivinhação.
          logger.warn(
            {
              statusCode,
              reason:
                typeof statusCode === "number"
                  ? DisconnectReason[statusCode] || "unknown"
                  : "none",
              pairingActive: pairingRequestedGeneration === generation,
              pairingPhone: state.pairingPhone,
              hadPairingCode: Boolean(authState.creds?.pairingCode),
              registered: Boolean(authState.creds?.registered),
              manualDisconnect: Boolean(global.__waManualDisconnect),
              err: lastDisconnect?.error?.message,
            },
            "WhatsApp connection closed",
          );

          state.status = "disconnected";
          state.lastError = lastDisconnect?.error ? String(lastDisconnect.error.message || lastDisconnect.error) : null;
          state.connectedPhone = null;
          clientReadyAt = null;
          // O código de pareamento só vale enquanto vive o socket que o emitiu.
          clearPairingCode(state);
          if (loggedOut) {
            state.qrDataUrl = null;
          }
          if (global.__waClient === sock) {
            global.__waClient = undefined;
          }

          if (loggedOut || abandonedPairing) {
            const resetPromise = auth.clearSession();
            global.__waAuthResetPromise = resetPromise;
            void resetPromise.catch((error) => {
              state.authPersistenceHealthy = false;
              logger.error(
                { err: error },
                "Failed to clear WhatsApp auth state after connection close",
              );
            });
            if (abandonedPairing) {
              // O motivo vai para a tela junto da orientação: sem ele o operador só
              // sabe que falhou, e o diagnóstico dependeria de abrir o log do Render.
              const reasonLabel =
                typeof statusCode === "number"
                  ? `${DisconnectReason[statusCode] || "desconhecido"} (${statusCode})`
                  : "sem código";
              const issuedAgoMs = state.pairingCodeIssuedAt
                ? Date.now() - new Date(state.pairingCodeIssuedAt).getTime()
                : null;
              const elapsedLabel =
                issuedAgoMs !== null
                  ? ` A conexão durou ${Math.round(issuedAgoMs / 1000)}s após o código ser gerado.`
                  : "";
              state.lastPairingFailure =
                `A conexão caiu durante o pareamento — motivo: ${reasonLabel}.${elapsedLabel}` +
                " Gere um novo código e digite-o no celular assim que ele aparecer.";
              state.lastError = state.lastPairingFailure;
              logger.warn(
                "Abandoned WhatsApp pairing attempt; session cleared so the next attempt starts from registration",
              );
            } else {
              logger.warn(
                "WhatsApp session logged out; stored state cleared and a new QR Code is required",
              );
            }
          }

          if (
            shouldAutoReconnectWhatsapp(
              loggedOut,
              Boolean(global.__waManualDisconnect),
            )
          ) {
            global.__waReconnectTimer = setTimeout(() => {
              global.__waReconnectTimer = undefined;
              // `initWhatsappClient` aguarda `__waAuthResetPromise`, então a limpeza
              // acima sempre precede o socket novo.
              void initWhatsappClient().catch((err) => {
                logger.error({ err }, "Failed to auto-reconnect WhatsApp client");
              });
            }, RECONNECT_DELAY_MS);
            global.__waReconnectTimer.unref();
          }
        }
      });

      // Agenda da loja: o pushName é o nome que o próprio cliente escolheu no perfil,
      // enquanto estes eventos trazem o nome que a loja salvou — o que identifica um
      // cliente recorrente no atendimento.
      const syncDirectory = (
        source: string,
        contacts: Array<{ id?: string | null; name?: string | null; notify?: string | null; verifiedName?: string | null }>,
      ) => {
        let withoutPhone = 0;
        let withoutName = 0;
        let withName = 0;
        let withVerifiedName = 0;
        let withNotify = 0;

        const entries = contacts
          .map((contact) => {
            const phone = whatsappPhoneFromJid(String(contact.id || ""));
            if (!phone) {
              withoutPhone += 1;
              return null;
            }
            const agendaName = String(contact.name || "").trim();
            const verifiedName = String(contact.verifiedName || "").trim();
            const notify = String(contact.notify || "").trim();
            if (agendaName) withName += 1;
            if (verifiedName) withVerifiedName += 1;
            if (notify) withNotify += 1;

            // `name` é o nome salvo pela loja e tem precedência. Aceitar também
            // verifiedName e notify era necessário: exigir só `name` descartava toda
            // a carga quando o WhatsApp entrega o contato sem o nome da agenda.
            const displayName = agendaName || verifiedName || notify;
            if (!displayName) {
              withoutName += 1;
              return null;
            }
            return {
              phoneNumber: phone,
              displayName,
              jid: phoneToChatId(phone),
            };
          })
          .filter((entry): entry is { phoneNumber: string; displayName: string; jid: string } => entry !== null);

        // Sem isto não há como saber se a sincronização não trouxe nada ou se trouxe e
        // foi descartada aqui — foi exatamente essa dúvida que travou o diagnóstico.
        logger.info(
          {
            source,
            received: contacts.length,
            usable: entries.length,
            withName,
            withVerifiedName,
            withNotify,
            withoutName,
            withoutPhone,
          },
          "WhatsApp contact event received",
        );
        if (!entries.length) return;
        void Promise.all([
          upsertWhatsappDirectoryEntries(DEFAULT_ORGANIZATION_ID, entries)
            .then((saved) => {
              if (saved) logger.info({ saved }, "Synced WhatsApp directory entries");
            })
            .catch((err) => {
              logger.warn({ err }, "Failed to sync WhatsApp directory entries");
            }),
          // A agenda também vira contato na plataforma, para a loja encontrar o
          // número sem depender de a pessoa ter escrito antes.
          importWhatsappContacts(DEFAULT_ORGANIZATION_ID, entries)
            .then((created) => {
              if (created) logger.info({ created }, "Imported WhatsApp contacts");
            })
            .catch((err) => {
              logger.warn({ err }, "Failed to import WhatsApp contacts");
            }),
        ]).then(() => {
          // Esperar a importação evita a corrida em que a foto chega antes de o
          // contato existir. O processamento segue em segundo plano e com limite.
          scheduleWhatsappContactAvatarSync(sock, entries, source);
        });
      };

      sock.ev.on("messaging-history.set", ({ contacts }) => {
        if (generation !== currentWhatsappGeneration()) return;
        syncDirectory("messaging-history.set", contacts || []);
      });
      sock.ev.on("contacts.upsert", (contacts) => {
        if (generation !== currentWhatsappGeneration()) return;
        syncDirectory("contacts.upsert", contacts || []);
      });
      sock.ev.on("contacts.update", (contacts) => {
        if (generation !== currentWhatsappGeneration()) return;
        syncDirectory("contacts.update", contacts || []);
      });

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify" && type !== "append") return;
        for (const msg of messages) {
          if (!msg.message) continue;
          whatsappMessageProcessingTail = whatsappMessageProcessingTail
            .then(async () => {
              if (msg.key?.fromMe) {
                await processOutboundMessageFromDevice(sock, msg);
              } else {
                await processInboundMessage(sock, msg);
              }
            })
            .catch((error) => {
              logger.error(
                { err: error, direction: msg.key?.fromMe ? "outbound" : "inbound" },
                "Failed to process queued WhatsApp message",
              );
            });
        }
      });

      global.__waClient = sock;
      state.initializationStage = null;
      return state;
    } catch (error) {
      state.status = "error";
      state.lastError = String((error as KnownError)?.message || error);
      state.connectedPhone = null;
      const failedStage = state.initializationStage || "socket";
      state.diagnosticCode = classifyWhatsappInitializationError(
        failedStage,
        error,
      );
      if (failedStage === "auth-store") {
        state.authPersistenceHealthy = false;
      }
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

/**
 * Encerra o cliente WhatsApp.
 *
 * Com `logout: true` (botão "Desconectar" do painel) faz o desligamento completo:
 * desparelha o aparelho no WhatsApp e apaga a sessão persistida. Só assim o
 * "Gerar QR" seguinte produz um QR de verdade — encerrar apenas o socket mantém
 * as credenciais registradas e o Baileys reconecta sozinho no mesmo número.
 */
export async function destroyWhatsappClient(options?: { logout?: boolean }) {
  const fullLogout = options?.logout === true;

  if (global.__waDestroyPromise) {
    await global.__waDestroyPromise;
    return;
  }

  const destroyPromise = (async () => {
    global.__waManualDisconnect = true;
    // Invalida os callbacks do socket atual antes de qualquer await.
    nextWhatsappGeneration();
    if (global.__waReconnectTimer) {
      clearTimeout(global.__waReconnectTimer);
      global.__waReconnectTimer = undefined;
    }

    const sock = global.__waClient;
    global.__waClient = undefined;

    if (sock && fullLogout) {
      try {
        await withTimeout(sock.logout(), WA_LOGOUT_TIMEOUT_MS, "logout do WhatsApp");
      } catch (error) {
        // O aparelho pode já ter sido removido pelo celular ou o socket já ter caído.
        // A limpeza local abaixo é o que garante o QR novo, então seguimos adiante.
        logger.warn({ err: error }, "WhatsApp logout request failed; clearing local session anyway");
      }
    }

    if (sock) {
      try {
        sock.end(undefined);
      } catch (error) {
        if (!isKnownWhatsappNoiseError(error)) {
          logger.error({ err: error }, "Failed to destroy WhatsApp client");
        } else {
          logger.warn({ err: error }, "Ignoring known WhatsApp destroy noise");
        }
      }
    }

    const state = getState();
    state.status = "disconnected";
    state.qrDataUrl = null;
    clearPairingCode(state);
    state.connectedPhone = null;
    clientReadyAt = null;

    if (fullLogout) {
      // A agenda importada pertence ao número que está saindo: mantê-la deixaria
      // contatos de outra conta no painel depois de conectar um número diferente.
      // Quem já tem conversa é preservado — apagar levaria o histórico junto.
      await Promise.all([
        deleteImportedWhatsappContacts(DEFAULT_ORGANIZATION_ID)
          .then((removed) => {
            if (removed) logger.info({ removed }, "Removed imported WhatsApp contacts on disconnect");
          })
          .catch((err) => {
            logger.warn({ err }, "Failed to remove imported WhatsApp contacts");
          }),
        clearWhatsappDirectory(DEFAULT_ORGANIZATION_ID).catch((err) => {
          logger.warn({ err }, "Failed to clear WhatsApp directory");
        }),
      ]);

      // Propaga a falha: sem limpar a sessão o próximo QR reconectaria o número
      // antigo, e reportar sucesso aqui esconderia exatamente esse defeito.
      await clearWhatsappAuthState();
      state.lastError = null;
    }
  })();

  global.__waDestroyPromise = destroyPromise;
  try {
    await destroyPromise;
  } finally {
    global.__waDestroyPromise = undefined;
  }
}

/**
 * Conecta pelo número de telefone em vez do QR Code.
 *
 * O WhatsApp aceita um código de 8 caracteres digitado em
 * "Aparelhos conectados > Conectar aparelho > Conectar com número de telefone".
 * É a única saída quando a câmera do aparelho não consegue ler o QR.
 *
 * Exige uma sessão nova: o WhatsApp só emite código para credenciais ainda não
 * registradas, então uma sessão anterior precisa ser desconectada antes.
 */
export async function requestWhatsappPairingCode(phone: string): Promise<{
  pairingCode: string;
  phone: string;
  expiresAt: string;
}> {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    throw new Error(
      "A conexão por código exige WHATSAPP_PROVIDER=unofficial (WhatsApp via QR/código).",
    );
  }

  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) {
    throw new Error(
      "Informe o número com DDI e DDD, somente dígitos. Ex.: 5562991234567.",
    );
  }

  const state = getState();
  if (state.status === "ready") {
    throw new Error(
      "Já existe um WhatsApp conectado. Clique em Desconectar antes de parear outro número.",
    );
  }
  // A falha anterior não deve poluir a leitura da tentativa que começa agora.
  state.lastPairingFailure = null;

  // Sempre sobe um socket novo. O socket em execução — criado no boot pelo
  // WHATSAPP_AUTO_CONNECT e vivo desde então — pode já ter consumido quase toda a
  // lista de refs de QR, e o código emitido nele herdaria só o tempo restante, às
  // vezes segundos. Recriar garante a janela cheia a cada pedido.
  await destroyWhatsappClient();
  await initWhatsappClient({ pairingMode: true });

  const deadline = Date.now() + WA_PAIRING_SOCKET_WAIT_MS;
  while (Date.now() < deadline) {
    const sock = global.__waClient;
    // `status === "qr"` significa socket no ar e sessão aguardando registro,
    // que é exatamente a janela em que o WhatsApp emite o código.
    if (sock && getState().status === "qr") {
      if (sock.authState?.creds?.registered) {
        throw new Error(
          "A sessão anterior ainda está registrada. Clique em Desconectar e tente novamente.",
        );
      }

      const pairingCode = await sock.requestPairingCode(digits);
      pairingRequestedGeneration = currentWhatsappGeneration();
      const expiresAt = new Date(Date.now() + WA_PAIRING_CODE_TTL_MS).toISOString();

      const current = getState();
      current.pairingCode = pairingCode;
      current.pairingPhone = `+${digits}`;
      current.pairingCodeIssuedAt = new Date().toISOString();
      current.pairingCodeExpiresAt = expiresAt;
      // Pedir o código invalida o QR daquela sessão: exibir os dois confundiria.
      current.qrDataUrl = null;
      current.lastError = null;

      logger.info({ phone: `+${digits}` }, "WhatsApp pairing code issued");
      return { pairingCode, phone: `+${digits}`, expiresAt };
    }

    if (getState().status === "error") {
      throw new Error(
        getState().lastError || "Falha ao inicializar o WhatsApp para o pareamento.",
      );
    }

    await new Promise((r) => setTimeout(r, 250));
  }

  throw new Error(
    "O WhatsApp não ficou pronto para emitir o código a tempo. Tente novamente em instantes.",
  );
}

/**
 * Força a resincronização da agenda do aparelho conectado.
 *
 * Os contatos chegam pelo app state, que normalmente só é buscado ao conectar. Sem
 * isto, a operação teria de desconectar e reconectar para ver a agenda atualizada.
 *
 * O resync entrega os contatos pelos eventos `contacts.upsert` e
 * `messaging-history.set`, que já gravam a agenda e criam os contatos — então esta
 * função dispara e aguarda o assentamento, sem duplicar a lógica de importação.
 */
export async function resyncWhatsappContacts(): Promise<void> {
  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    throw new Error(
      "A sincronização de contatos exige o WhatsApp conectado por QR ou código.",
    );
  }

  const sock = global.__waClient;
  if (!sock || getState().status !== "ready") {
    throw new Error(
      "Conecte o WhatsApp antes de sincronizar os contatos do celular.",
    );
  }

  // O clique manual significa atualização explícita. Permitir nova consulta mesmo
  // para contatos vistos recentemente captura uma foto alterada no WhatsApp.
  recentlySyncedAvatarAt.clear();
  lastContactAvatarSync = {
    requested: 0,
    found: 0,
    saved: 0,
    unavailable: 0,
    completedAt: null,
  };

  // Todas as coleções: as ações de contato vivem em critical_unblock_low, mas a
  // agenda também aparece em outras, e pedir só uma deixaria nomes de fora.
  // `isInitialSync: true` refaz a busca do zero em vez de pegar só o que mudou.
  await sock.resyncAppState(
    ["critical_block", "critical_unblock_low", "regular_high", "regular_low", "regular"],
    true,
  );
}

/**
 * Confirma se o número tem WhatsApp antes de a operação iniciar uma conversa.
 *
 * Retorna `null` quando não há como verificar (provedor diferente, sessão não
 * conectada) — nesse caso quem chama decide seguir, em vez de bloquear o envio por
 * falta de informação.
 */
export type WhatsappDestinationResolution =
  | {
      status: "verified" | "unverified";
      phone: string;
      jid: string;
      corrected: boolean;
      candidatesChecked: number;
    }
  | {
      status: "invalid" | "not_found" | "unavailable";
      candidatesChecked: number;
      reason: string;
    };

function maskedPhone(phone: string): string {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `***${digits.slice(-4)}` : "invalid";
}

/**
 * Resolve o destino uma única vez e conserva o JID canônico devolvido pelo
 * WhatsApp. Reconstruir o JID a partir do texto digitado anulava justamente a
 * correção feita por `onWhatsApp`, sobretudo na variação brasileira do 9º dígito.
 */
export async function resolveWhatsappDestination(
  phone: string,
): Promise<WhatsappDestinationResolution> {
  const candidates = whatsappPhoneCandidates(phone);
  if (!candidates.length) {
    return {
      status: "invalid",
      candidatesChecked: 0,
      reason: "Telefone fora do formato E.164",
    };
  }

  const provider = process.env.WHATSAPP_PROVIDER || "twilio";
  if (provider !== "unofficial") {
    const digits = candidates[0];
    return {
      status: "unverified",
      phone: toWhatsAppAddress(digits),
      jid: `${digits}@s.whatsapp.net`,
      corrected: digits !== String(phone).replace(/\D/g, ""),
      candidatesChecked: 0,
    };
  }

  const sock = global.__waClient;
  if (!sock || getState().status !== "ready") {
    return {
      status: "unavailable",
      candidatesChecked: 0,
      reason: "WhatsApp conectado ainda não está pronto",
    };
  }

  try {
    const result = await sock.onWhatsApp(...candidates);
    const match = result?.find(
      (candidate) => candidate.exists && isDirectUserJid(candidate.jid),
    );
    if (!match) {
      logger.info(
        {
          phone: maskedPhone(phone),
          stage: "formatJID",
          candidatesChecked: candidates.length,
          status: "not_found",
        },
        "Active conversation destination not found on WhatsApp",
      );
      return {
        status: "not_found",
        candidatesChecked: candidates.length,
        reason: "Número não encontrado no WhatsApp",
      };
    }

    const canonicalPhone = whatsappPhoneFromJid(match.jid);
    if (!canonicalPhone) {
      return {
        status: "not_found",
        candidatesChecked: candidates.length,
        reason: "WhatsApp não devolveu um JID de telefone válido",
      };
    }

    const canonicalDigits = canonicalPhone.replace(/\D/g, "");
    logger.info(
      {
        phone: maskedPhone(canonicalPhone),
        stage: "formatJID",
        candidatesChecked: candidates.length,
        corrected: canonicalDigits !== String(phone).replace(/\D/g, ""),
        status: "verified",
      },
      "Active conversation destination resolved",
    );
    return {
      status: "verified",
      phone: canonicalPhone,
      jid: match.jid,
      corrected: canonicalDigits !== String(phone).replace(/\D/g, ""),
      candidatesChecked: candidates.length,
    };
  } catch (err) {
    logger.warn(
      {
        err,
        phone: maskedPhone(phone),
        stage: "checkNumberStatus",
        candidatesChecked: candidates.length,
      },
      "Failed to resolve active conversation destination",
    );
    return {
      status: "unavailable",
      candidatesChecked: candidates.length,
      reason: "Não foi possível consultar o número no WhatsApp",
    };
  }
}

export async function whatsappNumberExists(phone: string): Promise<boolean | null> {
  const resolution = await resolveWhatsappDestination(phone);
  if (resolution.status === "verified") return true;
  if (resolution.status === "invalid" || resolution.status === "not_found") return false;
  return null;
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

function buildOutboundMediaContent(
  mediaUrl: string,
  caption?: string,
  options?: { mimeType?: string; fileName?: string },
): AnyMessageContent {
  const clean = mediaUrl.split("?")[0].toLowerCase();
  const declaredMimeType = String(options?.mimeType || "").toLowerCase();
  if (declaredMimeType.startsWith("image/") || /\.(jpe?g|png|gif|webp)$/.test(clean)) {
    return { image: { url: mediaUrl }, caption: caption || undefined };
  }
  if (declaredMimeType.startsWith("video/") || /\.(mp4|3gp|mov)$/.test(clean)) {
    return { video: { url: mediaUrl }, caption: caption || undefined };
  }
  if (declaredMimeType.startsWith("audio/") || /\.(mp3|ogg|oga|m4a|wav|opus)$/.test(clean)) {
    return { audio: { url: mediaUrl }, mimetype: declaredMimeType || "audio/mpeg" };
  }
  const fileName = options?.fileName || mediaUrl.split("/").pop() || "arquivo";
  const extMatch = /\.([a-z0-9]+)$/.exec(clean);
  const documentMimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    txt: "text/plain",
  };
  const mimetype =
    declaredMimeType ||
    (extMatch && documentMimeTypes[extMatch[1]]) ||
    "application/octet-stream";
  return { document: { url: mediaUrl }, mimetype, fileName, caption: caption || undefined };
}

/** Envio via Baileys (QR). Triagem/bot e `fromBot` usam apenas este caminho.
 * Mensagens do atendente pelo painel com Twilio continuam em `conversations/[id]/messages`. */
export async function sendWhatsappMessage(
  toPhone: string,
  text: string,
  options?: {
    skipRateLimit?: boolean;
    mediaUrl?: string;
    fromBot?: boolean;
    destinationJid?: string;
    mimeType?: string;
    fileName?: string;
  },
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

  const digits = whatsappPhoneCandidates(toPhone)[0] || "";
  if (!digits) {
    throw new Error(`Telefone invalido para envio WhatsApp: ${toPhone}`);
  }

  const jid = options?.destinationJid || phoneToChatId(toPhone);
  if (!/@(s\.whatsapp\.net|hosted)$/i.test(jid)) {
    throw new Error("Destino WhatsApp inválido para envio");
  }

  // Marca como envio de bot ANTES de enviar, para que o listener de mensagens
  // gerado pelo Baileys (fromMe) seja reconhecido como automático.
  if (options?.fromBot) {
    recentBotSends.add(jid);
  }

  let sent: WAMessage | undefined;
  if (options?.mediaUrl) {
    sent = await sock.sendMessage(
      jid,
      buildOutboundMediaContent(options.mediaUrl, text, {
        mimeType: options.mimeType,
        fileName: options.fileName,
      }),
    );
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
  options?: { skipRateLimit?: boolean; fromBot?: boolean; mediaUrl?: string },
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
      ...(options?.mediaUrl ? { mediaUrl: [options.mediaUrl] } : {}),
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

import { logger } from "@/lib/logger";
import { listConversations } from "@/lib/repo";

export type WillTalkWebhookEvent =
  | "ticket_created"
  | "ticket_updated"
  | "message_received"
  | "message_sent";

type ConversationMessage = {
  createdAt?: string;
  direction?: string;
  content?: string;
  type?: string;
  authorName?: string | null;
};

type ConversationSnapshot = {
  id: string;
  contact?: {
    name?: string | null;
    phoneNumber?: string | null;
  } | null;
  ticket?: {
    id?: string;
    assignee?: {
      name?: string | null;
    } | null;
  } | null;
  messages?: ConversationMessage[];
};

type SendWebhookParams = {
  event: WillTalkWebhookEvent;
  organizationId: string;
  conversationId: string;
  fallback?: {
    ticketId?: string;
    cliente?: string;
    /** E.164 ou whatsapp:+55... — usado pelo n8n quando não há snapshot */
    telefone?: string;
    canal?: string;
    tecnico?: string;
    mensagem?: string;
    dataEvento?: string;
  };
};

const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 8000;
const FAILURE_COOLDOWN_MS = 5000;
const FAILURE_LOG_WINDOW_MS = 5000;
const DEFAULT_EVENTS: WillTalkWebhookEvent[] = [
  "ticket_created",
  "ticket_updated",
  "message_received",
  "message_sent",
];

const noisePatterns: RegExp[] = [
  /^demanda \*.*\* registrada/i,
  /^nao consegui identificar a opcao/i,
  /^tentativa \d+\/\d+/i,
  /^mensagem recebida\./i,
  /^obrigado pela sua avalia/i,
  /^seu atendimento com .* foi finalizado/i,
  /^de 1 a 5, qual nota/i,
  /^estamos fora do horario comercial/i,
];

const endpointCooldownUntil = new Map<string, number>();
const compactFailureState = new Map<
  string,
  {
    lastLogAt: number;
    suppressed: number;
  }
>();

function parseIntEnv(rawValue: string | undefined, fallback: number) {
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseEnabledEvents(rawValue: string | undefined): Set<WillTalkWebhookEvent> {
  if (!rawValue) return new Set(DEFAULT_EVENTS);
  const normalized = rawValue
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const supported = new Set(DEFAULT_EVENTS);
  return new Set(
    normalized.filter((value): value is WillTalkWebhookEvent =>
      supported.has(value as WillTalkWebhookEvent),
    ),
  );
}

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeMessageContent(value: string) {
  const compact = compactText(value);
  if (!compact) return "";
  if (noisePatterns.some((pattern) => pattern.test(compact))) return "";
  return compact;
}

function detectChannel(phoneNumber?: string | null, fallback?: string) {
  if (fallback) return fallback;
  const normalized = (phoneNumber || "").toLowerCase();
  if (normalized.startsWith("whatsapp:")) return "whatsapp";
  if (normalized) return "telefone";
  return undefined;
}

function normalizeActorLabel(message: ConversationMessage) {
  if (message.direction === "inbound") return "cliente";
  const authorName = message.authorName ? compactText(String(message.authorName)) : "";
  return authorName || "atendente";
}

function formatMessageLine(message: ConversationMessage) {
  const timestamp = message.createdAt ? String(message.createdAt) : new Date().toISOString();
  const actor = normalizeActorLabel(message);
  const msgType = message.type || "text";
  const sanitized = sanitizeMessageContent(String(message.content || ""));
  const content = sanitized || (msgType !== "text" ? `[${msgType}]` : "");
  if (!content) return "";
  return `${timestamp} | ${actor}: ${content}`;
}

function consolidateMessages(messages: ConversationMessage[], maxChars: number) {
  const sorted = [...messages].sort((a, b) =>
    String(a.createdAt || "").localeCompare(String(b.createdAt || "")),
  );

  const lines = sorted
    .map((message) => formatMessageLine(message))
    .filter((line) => line.length > 0);

  if (lines.length === 0) return "";

  const keptFromLatest: string[] = [];
  let totalChars = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const additional = line.length + (keptFromLatest.length > 0 ? 1 : 0);
    if (totalChars + additional > maxChars) break;
    keptFromLatest.push(line);
    totalChars += additional;
  }

  keptFromLatest.reverse();
  if (keptFromLatest.length === lines.length) return keptFromLatest.join("\n");

  const removed = lines.length - keptFromLatest.length;
  return `[historico truncado: ${removed} mensagens antigas removidas]\n${keptFromLatest.join("\n")}`;
}

async function loadConversationSnapshot(
  organizationId: string,
  conversationId: string,
): Promise<ConversationSnapshot | null> {
  const conversations = await listConversations(organizationId);
  const found = conversations.find((conversation) => String(conversation.id) === conversationId);
  if (!found) return null;
  return found as ConversationSnapshot;
}

function buildIngestionPayload(
  conversation: ConversationSnapshot | null,
  fallback: SendWebhookParams["fallback"],
  maxChars: number,
) {
  const ticketId =
    conversation?.ticket?.id ||
    fallback?.ticketId ||
    conversation?.id ||
    "ticket-desconhecido";
  const cliente =
    compactText(String(conversation?.contact?.name || fallback?.cliente || "")) ||
    String(conversation?.contact?.phoneNumber || "Cliente sem nome");
  const canal = detectChannel(conversation?.contact?.phoneNumber, fallback?.canal);
  const tecnico =
    compactText(String(conversation?.ticket?.assignee?.name || fallback?.tecnico || "")) || undefined;
  const mensagensConsolidadas = conversation?.messages?.length
    ? consolidateMessages(conversation.messages, maxChars)
    : "";
  const mensagens =
    mensagensConsolidadas ||
    sanitizeMessageContent(String(fallback?.mensagem || "")) ||
    "[sem mensagens relevantes]";
  const dataEvento = fallback?.dataEvento || new Date().toISOString();

  const rawPhone =
    (conversation?.contact?.phoneNumber || "").trim() || (fallback?.telefone || "").trim() || "";
  const cliente_telefone = rawPhone.replace(/\D/g, "");

  return {
    ticket_id: String(ticketId),
    cliente,
    cliente_telefone,
    mensagens,
    canal,
    tecnico,
    data_evento: dataEvento,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isNetworkConnectionError(error: unknown) {
  const message = String((error as { message?: string })?.message || error || "").toLowerCase();
  return (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("fetch failed")
  );
}

function shouldLogAttemptFailure(key: string) {
  const now = Date.now();
  const state = compactFailureState.get(key);
  if (!state) {
    compactFailureState.set(key, { lastLogAt: now, suppressed: 0 });
    return { log: true, suppressed: 0 };
  }

  if (now - state.lastLogAt <= FAILURE_LOG_WINDOW_MS) {
    state.suppressed += 1;
    compactFailureState.set(key, state);
    return { log: false, suppressed: state.suppressed };
  }

  const suppressed = state.suppressed;
  compactFailureState.set(key, { lastLogAt: now, suppressed: 0 });
  return { log: true, suppressed };
}

export async function sendWillTalkWebhook(params: SendWebhookParams) {
  const webhookUrl = process.env.WILLTALK_WEBHOOK_URL;
  if (!webhookUrl) return;

  const enabledEvents = parseEnabledEvents(process.env.WILLTALK_WEBHOOK_EVENTS);
  if (!enabledEvents.has(params.event)) return;

  const maxChars = parseIntEnv(process.env.WILLTALK_WEBHOOK_MAX_CHARS, DEFAULT_MAX_CHARS);
  const attempts = parseIntEnv(process.env.WILLTALK_WEBHOOK_ATTEMPTS, DEFAULT_ATTEMPTS);
  const timeoutMs = parseIntEnv(process.env.WILLTALK_WEBHOOK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const endpointKey = webhookUrl;
  const eventKey = `${params.organizationId}:${params.conversationId}:${params.event}`;

  const cooldownUntil = endpointCooldownUntil.get(endpointKey) || 0;
  if (cooldownUntil > Date.now()) {
    const remainingMs = cooldownUntil - Date.now();
    const failureLogState = shouldLogAttemptFailure(eventKey);
    if (failureLogState.log) {
      logger.warn(
        {
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          event: params.event,
          webhookUrl,
          remainingMs,
          suppressedFailures: failureLogState.suppressed,
        },
        "WillTalk webhook skipped during endpoint cooldown",
      );
    }
    return;
  }

  let conversation: ConversationSnapshot | null = null;
  try {
    conversation = await loadConversationSnapshot(params.organizationId, params.conversationId);
  } catch (error) {
    logger.warn(
      {
        err: error,
        organizationId: params.organizationId,
        conversationId: params.conversationId,
      },
      "Failed to load conversation snapshot for webhook payload",
    );
  }

  const payload = buildIngestionPayload(conversation, params.fallback, maxChars);
  const body = {
    ...payload,
  };

  const token = process.env.WILLTALK_WEBHOOK_TOKEN || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-willtalk-event": params.event,
    Authorization: `Bearer ${token}`,
  };

  let lastError: unknown = null;
  let lastStatus: number | null = null;
  let lastResponseBody = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const responseText = (await response.text()).slice(0, 600);
      lastStatus = response.status;
      lastResponseBody = responseText;

      if (response.ok) {
        endpointCooldownUntil.delete(endpointKey);
        compactFailureState.delete(eventKey);
        logger.info(
          {
            organizationId: params.organizationId,
            conversationId: params.conversationId,
            event: params.event,
            webhookUrl,
            status: response.status,
            responseBody: responseText,
          },
          "WillTalk webhook delivered",
        );
        return;
      }

      lastError = new Error(`Webhook HTTP ${response.status} - ${responseText}`);
      logger.warn(
        {
          organizationId: params.organizationId,
          conversationId: params.conversationId,
          event: params.event,
          webhookUrl,
          attempt,
          attempts,
          status: response.status,
          responseBody: responseText,
        },
        "WillTalk webhook attempt failed",
      );
    } catch (error) {
      lastError = error;
      if (isNetworkConnectionError(error)) {
        endpointCooldownUntil.set(endpointKey, Date.now() + FAILURE_COOLDOWN_MS);
      }
      const failureLogState = shouldLogAttemptFailure(eventKey);
      if (failureLogState.log) {
        logger.warn(
          {
            err: error,
            organizationId: params.organizationId,
            conversationId: params.conversationId,
            event: params.event,
            webhookUrl,
            attempt,
            attempts,
            suppressedFailures: failureLogState.suppressed,
          },
          "WillTalk webhook attempt failed",
        );
      }
    }

    if (attempt < attempts) {
      await sleep(400 * 2 ** (attempt - 1));
    }
  }

  logger.error(
    {
      err: lastError,
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      event: params.event,
      webhookUrl,
      status: lastStatus,
      responseBody: lastResponseBody,
      suppressedFailures: compactFailureState.get(eventKey)?.suppressed || 0,
    },
    "Failed to deliver WillTalk webhook after retries",
  );
  compactFailureState.delete(eventKey);
}

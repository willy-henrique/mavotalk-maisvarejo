import { SUPERMARKET_QUEUE_PRESET, getSupermarketPresetByOption, queueTypeForMenuOption } from "./supermarket-config";
import { matchMenuEntry, renderMenuOptions, type BotMenuEntry } from "./bot-menu";

export type SupermarketBotConfig = {
  enabled: boolean;
  botName: string;
  storeName: string;
  address: string | null;
  mapsUrl: string | null;
  weekdayHours: string | null;
  sundayHours: string | null;
  offersUrl: string | null;
  offersText: string | null;
  offersImageUrl: string | null;
  offersImagePublicId: string | null;
  phone: string | null;
  aiFallbackEnabled: boolean;
};

export type SupermarketBotDecision = {
  handled: true;
  kind: "menu" | "self-service" | "collect-details" | "human-handoff" | "silent-human";
  replyText: string | null;
  queueMenuOption: number | null;
  /** Fila escolhida. Preferir isto a `queueMenuOption`: a posição no menu é editável pelo tenant. */
  queueId: string | null;
  queueType: BotMenuEntry["queueType"] | null;
  clearQueue: boolean;
  triageCompleted: boolean;
  appendOutOfHours: boolean;
  mediaUrl?: string | null;
  reason: string;
};

export type DecideSupermarketBotParams = {
  message: string;
  customerName?: string | null;
  isNewConversation: boolean;
  triageCompleted: boolean;
  /** Atendimento já sob responsabilidade de uma pessoa (puxado ou iniciado pela loja). */
  humanHandled?: boolean;
  currentQueueMenuOption?: number | null;
  businessOpen: boolean;
  config?: SupermarketBotConfig;
  /** Opções do menu (1–6) atualmente ativas nas filas do tenant. Sem isto, assume-se o preset completo. */
  activeMenuOptions?: readonly number[];
  /**
   * Filas reais do tenant. Quando informadas, o menu passa a exibir o nome
   * cadastrado no painel e o comportamento segue o `queueType` de cada fila.
   * Sem elas, o decisor cai no preset de supermercado (tenants não migrados).
   */
  menuEntries?: readonly BotMenuEntry[];
};

function optionalEnv(name: string): string | null {
  const value = String(process.env[name] || "").trim();
  return value || null;
}

function envFlag(name: string, fallback: boolean): boolean {
  const raw = optionalEnv(name);
  if (!raw) return fallback;
  return raw.toLowerCase() !== "false";
}

export function getSupermarketBotConfig(): SupermarketBotConfig {
  return {
    enabled: envFlag("SUPERMARKET_BOT_ENABLED", true),
    botName: optionalEnv("SUPERMARKET_BOT_NAME") || "Mavo",
    storeName: optionalEnv("SUPERMARKET_NAME") || "Supermercado",
    address: optionalEnv("SUPERMARKET_ADDRESS"),
    mapsUrl: optionalEnv("SUPERMARKET_MAPS_URL"),
    weekdayHours: optionalEnv("SUPERMARKET_HOURS_WEEKDAYS"),
    sundayHours: optionalEnv("SUPERMARKET_HOURS_SUNDAY"),
    offersUrl: optionalEnv("SUPERMARKET_OFFERS_URL"),
    offersText: optionalEnv("SUPERMARKET_OFFERS_TEXT"),
    offersImageUrl: optionalEnv("SUPERMARKET_OFFERS_IMAGE_URL"),
    offersImagePublicId: optionalEnv("SUPERMARKET_OFFERS_IMAGE_PUBLIC_ID"),
    phone: optionalEnv("SUPERMARKET_PHONE"),
    aiFallbackEnabled: envFlag("SUPERMARKET_AI_FALLBACK_ENABLED", false),
  };
}

export function isSupermarketBotEnabled() {
  return getSupermarketBotConfig().enabled;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstName(value?: string | null): string {
  const normalized = String(value || "").trim();
  if (!normalized || normalizeText(normalized) === "cliente") return "";
  return normalized.split(/\s+/)[0];
}

function greetingByBrasiliaTime(date = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false,
    }).format(date),
  );
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

/**
 * No preset legado a opção 6 é sempre "falar com um atendente". Com as filas do
 * tenant esse número pode ser qualquer fila, então o atalho vira uma palavra.
 */
function navigationFooter(legacyMode = true) {
  return legacyMode
    ? "\n\nDigite *0* para voltar ao menu ou *6* para falar com a nossa equipe."
    : "\n\nDigite *0* para voltar ao menu ou escreva *atendente* para falar com a nossa equipe.";
}

/** Opção do preset legado como entrada de menu, usada pelas intenções de supermercado. */
function presetEntry(menuOption: number): BotMenuEntry {
  return {
    queueId: "",
    menuOption,
    name: getSupermarketPresetByOption(menuOption)?.name || "Atendimento",
    queueType: queueTypeForMenuOption(menuOption),
  };
}

/** Converte o preset de supermercado em opções de menu, para tenants sem filas informadas. */
function presetMenuEntries(activeMenuOptions?: readonly number[]): BotMenuEntry[] {
  const active = new Set(activeMenuOptions ?? SUPERMARKET_QUEUE_PRESET.map((item) => item.menuOption));
  return SUPERMARKET_QUEUE_PRESET.filter((item) => active.has(item.menuOption)).map((item) => ({
    queueId: "",
    menuOption: item.menuOption,
    name: item.name,
    queueType: queueTypeForMenuOption(item.menuOption),
  }));
}

/** Mantém a identidade configurada da loja visível em toda resposta do bot. */
function responseTitle(config: SupermarketBotConfig, title: string) {
  return `${title} · ${config.storeName}`;
}

export function buildSupermarketMenu(
  config: SupermarketBotConfig,
  customerName?: string | null,
  businessOpen = true,
  activeMenuOptions?: readonly number[],
  menuEntries?: readonly BotMenuEntry[],
): string {
  const name = firstName(customerName);
  const greeting = `${greetingByBrasiliaTime()}${name ? `, ${name}` : ""}! 👋`;
  const entries = menuEntries?.length ? menuEntries : presetMenuEntries(activeMenuOptions);
  const options = renderMenuOptions(entries);
  const availability = businessOpen
    ? "🟢 _Nossa equipe está disponível agora._"
    : "🌙 _Sua mensagem será registrada e respondida no próximo atendimento._";

  return (
    `${greeting}\n\n` +
    `Eu sou a *${config.botName}*, assistente virtual do *${config.storeName}*. ` +
    "Posso te ajudar rapidinho.\n\n" +
    options +
    "\n\nDigite o *número* da opção desejada ou escreva o que você precisa com suas próprias palavras." +
    "\nDigite *0* a qualquer momento para ver este menu novamente." +
    `\n\n${availability}`
  );
}

function offersReply(config: SupermarketBotConfig, legacyMode = true): string {
  const destination = config.offersText || (config.offersUrl
    ? `Veja as ofertas atualizadas aqui:\n${config.offersUrl}`
    : "As ofertas de hoje ainda não foram cadastradas. Nossa equipe pode enviar as promoções atuais para você.");
  return `🏷️ *${responseTitle(config, "Ofertas e promoções")}*\n\n${destination}${navigationFooter(legacyMode)}`;
}

function locationReply(config: SupermarketBotConfig, legacyMode = true): string {
  const hours = [config.weekdayHours, config.sundayHours].filter(Boolean).join("\n");
  const lines = [
    `📍 *${responseTitle(config, "Horários e localização")}*`,
    "",
    hours || "O horário de funcionamento ainda não foi configurado no bot.",
    config.address ? `\n*Endereço:* ${config.address}` : "\nO endereço da unidade ainda não foi configurado no bot.",
    config.mapsUrl ? `\n*Como chegar:* ${config.mapsUrl}` : "",
    config.phone ? `\n*Telefone:* ${config.phone}` : "",
  ];
  return `${lines.join("\n").trim()}${navigationFooter(legacyMode)}`;
}

function collectDetailsReply(entry: BotMenuEntry, config: SupermarketBotConfig): string {
  // Fila do tenant: nome livre, então o texto usa o que está cadastrado no painel
  // em vez dos roteiros de supermercado presos às opções 3 a 5.
  if (entry.queueId) {
    return (
      `📝 *${responseTitle(config, entry.name)}*\n\n` +
      "Me conte em uma mensagem o que você precisa, com os detalhes que já tiver.\n\n" +
      "Nossa equipe assume a conversa a partir daqui."
    );
  }
  const menuOption = entry.menuOption;
  if (menuOption === 3) {
    return (
      `🛒 *${responseTitle(config, "Consulta de produto")}*\n\n` +
      "Envie o *nome do produto*, a *marca* e o *tamanho ou peso* que procura.\n" +
      "Exemplo: _Café Melitta, pacote de 500 g_.\n\n" +
      "Um atendente confirmará preço e disponibilidade — o bot não inventa informações de estoque."
    );
  }
  if (menuOption === 4) {
    return (
      `🥩 *${responseTitle(config, "Setores frescos")}*\n\n` +
      "Diga qual setor e item você procura.\n" +
      "Exemplo: _Açougue — 2 kg de alcatra_ ou _Padaria — encomenda de bolo_."
    );
  }
  return (
    `💳 *${responseTitle(config, "Trocas, devoluções e pagamentos")}*\n\n` +
    "Conte resumidamente o que aconteceu. Se tiver, informe também o número do cupom, pedido ou comprovante.\n\n" +
    "Não envie senha, código do cartão ou outros dados bancários sensíveis."
  );
}

function detailsReceivedReply(
  menuOption: number,
  message: string,
  config: SupermarketBotConfig,
  queueName?: string | null,
): string {
  const preset = getSupermarketPresetByOption(menuOption);
  const summary = message.trim().replace(/\s+/g, " ").slice(0, 220);
  return (
    `✅ Obrigado! Registrei sua solicitação em *${queueName || preset?.name || "Atendimento"}* do *${config.storeName}*.\n\n` +
    `📝 _${summary}_\n\n` +
    "Nossa equipe recebeu o contexto e continuará o atendimento por aqui."
  );
}

function humanHandoffReply(config: SupermarketBotConfig, context?: string): string {
  const contextLine = context ? `\n\n📝 Registrei: _${context.trim().replace(/\s+/g, " ").slice(0, 220)}_` : "";
  return (
    `🙋 *Atendimento humano*\n\nCerto! Vou encaminhar você para a equipe do *${config.storeName}*.` +
    contextLine +
    "\n\nAguarde por aqui para não perder sua posição na fila."
  );
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function selectedMenuOption(normalized: string): number | null {
  const match = normalized.match(/^(?:opcao\s*)?([0-6])$/);
  return match ? Number(match[1]) : null;
}

function menuDecision(
  config: SupermarketBotConfig,
  customerName: string | null | undefined,
  businessOpen: boolean,
  activeMenuOptions?: readonly number[],
  menuEntries?: readonly BotMenuEntry[],
): SupermarketBotDecision {
  return {
    handled: true,
    kind: "menu",
    replyText: buildSupermarketMenu(config, customerName, businessOpen, activeMenuOptions, menuEntries),
    queueMenuOption: null,
    queueId: null,
    queueType: null,
    clearQueue: true,
    triageCompleted: false,
    appendOutOfHours: false,
    reason: "supermarket_main_menu",
  };
}

function humanHandoffDecision(
  config: SupermarketBotConfig,
  context?: string,
  entry?: BotMenuEntry,
): SupermarketBotDecision {
  return {
    handled: true,
    kind: "human-handoff",
    replyText: humanHandoffReply(config, context),
    queueMenuOption: entry?.menuOption ?? 6,
    queueId: entry?.queueId || null,
    queueType: entry?.queueType ?? null,
    clearQueue: false,
    triageCompleted: true,
    appendOutOfHours: true,
    reason: "supermarket_human_requested",
  };
}

/**
 * Decide a partir do tipo da fila escolhida, não da sua posição no menu. Mover
 * "Ofertas" da opção 1 para a 5 no painel não muda o que o cliente recebe.
 */
function entryDecision(
  entry: BotMenuEntry,
  config: SupermarketBotConfig,
  legacyMode: boolean,
): SupermarketBotDecision {
  const selfService = entry.queueType === "offers_promotions" || entry.queueType === "business_hours_location";

  if (selfService) {
    const isOffers = entry.queueType === "offers_promotions";
    // Sem conteúdo legado e sem configuração publicada da fila não há o que
    // responder sozinho; encaminhar é melhor que prometer uma oferta vazia.
    const missingSelfServiceData = isOffers
      ? !config.offersUrl && !config.offersText && !config.offersImageUrl
      : !config.weekdayHours && !config.sundayHours && !config.address && !config.mapsUrl;

    if (missingSelfServiceData) {
      const context = isOffers
        ? "Quero receber as ofertas e promoções atuais."
        : "Preciso confirmar o horário ou a localização da loja.";
      return {
        ...humanHandoffDecision(config, context, entry),
        reason: `supermarket_missing_self_service_config_${isOffers ? "offers" : "hours"}`,
      };
    }

    return {
      handled: true,
      kind: "self-service",
      replyText: isOffers ? offersReply(config, legacyMode) : locationReply(config, legacyMode),
      queueMenuOption: null,
      queueId: entry.queueId || null,
      queueType: entry.queueType,
      clearQueue: true,
      triageCompleted: false,
      appendOutOfHours: false,
      mediaUrl: isOffers ? config.offersImageUrl : null,
      reason: `supermarket_self_service_${isOffers ? "offers" : "hours"}`,
    };
  }

  // No preset legado a opção 6 é o encaminhamento humano.
  if (legacyMode && entry.menuOption === 6) return humanHandoffDecision(config, undefined, entry);

  return {
    handled: true,
    kind: "collect-details",
    replyText: collectDetailsReply(entry, config),
    queueMenuOption: entry.menuOption,
    queueId: entry.queueId || null,
    queueType: entry.queueType,
    clearQueue: false,
    triageCompleted: false,
    appendOutOfHours: false,
    reason: `supermarket_collect_details_${entry.queueId || entry.menuOption}`,
  };
}

export function decideSupermarketBot(params: DecideSupermarketBotParams): SupermarketBotDecision | null {
  const config = params.config || getSupermarketBotConfig();
  if (!config.enabled) return null;

  const rawMessage = String(params.message || "").trim();
  const normalized = normalizeText(rawMessage);
  const option = selectedMenuOption(normalized);
  const activeMenuOptions = params.activeMenuOptions ?? SUPERMARKET_QUEUE_PRESET.map((item) => item.menuOption);
  // Sem filas do tenant o decisor opera no preset de supermercado, onde a opção
  // 6 é sempre o atendimento humano. Com filas reais, nenhum número é reservado.
  const legacyMode = !params.menuEntries?.length;
  const entries = legacyMode ? presetMenuEntries(activeMenuOptions) : params.menuEntries!;
  const showMenu = () =>
    menuDecision(config, params.customerName, params.businessOpen, activeMenuOptions, entries);

  // Com uma pessoa no atendimento o bot não fala mais nada. Fica antes de qualquer
  // outra regra de propósito: um "bom dia" ou um número digitado no meio da conversa
  // reabriria o menu por cima do atendente.
  if (params.humanHandled) {
    return {
      handled: true,
      kind: "silent-human",
      replyText: null,
      queueMenuOption: params.currentQueueMenuOption || null,
      queueId: null,
      queueType: null,
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: false,
      reason: "human_already_handling_conversation",
    };
  }

  const isMenuCommand =
    option === 0 ||
    hasAny(normalized, ["voltar ao menu", "menu principal", "ver menu", "inicio", "comecar de novo"]) ||
    /^(oi|ola|bom dia|boa tarde|boa noite|menu)$/.test(normalized);
  if (isMenuCommand) {
    return showMenu();
  }

  const wantsHuman = hasAny(normalized, [
    "falar com atendente",
    "falar com humano",
    "atendimento humano",
    "quero um atendente",
    "chamar atendente",
    "reclamacao",
    "gerente",
  ]);
  if (wantsHuman || (legacyMode && option === 6)) {
    return humanHandoffDecision(config);
  }

  const selectedEntry = matchMenuEntry(rawMessage, entries);
  if (selectedEntry) {
    return entryDecision(selectedEntry, config, legacyMode);
  }

  // Número digitado que não corresponde a nenhuma fila ativa: reexibe o menu em
  // vez de seguir para a interpretação por palavra-chave.
  if (/^(?:opcao\s*)?\d{1,3}$/.test(normalized)) {
    return showMenu();
  }

  const awaitingDetails = legacyMode
    ? params.currentQueueMenuOption && [3, 4, 5].includes(params.currentQueueMenuOption)
    : Boolean(params.currentQueueMenuOption);
  if (!params.triageCompleted && awaitingDetails && params.currentQueueMenuOption) {
    const currentEntry = entries.find((item) => item.menuOption === params.currentQueueMenuOption);
    return {
      handled: true,
      kind: "human-handoff",
      replyText: detailsReceivedReply(params.currentQueueMenuOption, rawMessage, config, currentEntry?.name),
      queueMenuOption: params.currentQueueMenuOption,
      queueId: currentEntry?.queueId || null,
      queueType: currentEntry?.queueType ?? null,
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: true,
      reason: `supermarket_details_received_${params.currentQueueMenuOption}`,
    };
  }

  /** Resolve uma intenção por palavra-chave para a fila do tipo correspondente. */
  const entryByType = (queueType: BotMenuEntry["queueType"]) =>
    entries.find((item) => item.queueType === queueType) || null;

  if (hasAny(normalized, ["oferta", "ofertas", "promocao", "promocoes", "encarte", "desconto"])) {
    const offers = entryByType("offers_promotions");
    if (offers) return entryDecision(offers, config, legacyMode);
  }

  if (hasAny(normalized, ["horario", "abre", "fecha", "funcionamento", "endereco", "localizacao", "como chegar"])) {
    const hours = entryByType("business_hours_location");
    if (hours) return entryDecision(hours, config, legacyMode);
  }

  // As intenções abaixo são roteiros do preset de supermercado. Com filas do
  // tenant, os nomes das filas é que definem o encaminhamento.
  if (!legacyMode) {
    if (params.triageCompleted) {
      return {
        handled: true,
        kind: "silent-human",
        replyText: null,
        queueMenuOption: params.currentQueueMenuOption || null,
        queueId: null,
        queueType: null,
        clearQueue: false,
        triageCompleted: true,
        appendOutOfHours: false,
        reason: "supermarket_message_waiting_for_human",
      };
    }
    if (config.aiFallbackEnabled) return null;
    return showMenu();
  }

  const freshDepartment = hasAny(normalized, [
    "acougue",
    "carne",
    "padaria",
    "bolo",
    "pao",
    "hortifruti",
    "fruta",
    "verdura",
  ]);
  if (freshDepartment) {
    return {
      handled: true,
      kind: "collect-details",
      replyText: collectDetailsReply(presetEntry(4), config),
      queueMenuOption: 4,
      queueId: null,
      queueType: queueTypeForMenuOption(4),
      clearQueue: false,
      triageCompleted: false,
      appendOutOfHours: false,
      reason: "supermarket_fresh_department_intent",
    };
  }

  const financial = hasAny(normalized, [
    "troca",
    "devolucao",
    "reembolso",
    "pagamento",
    "cartao",
    "pix",
    "cobranca",
    "cupom fiscal",
  ]);
  if (financial) {
    return {
      handled: true,
      kind: "collect-details",
      replyText: collectDetailsReply(presetEntry(5), config),
      queueMenuOption: 5,
      queueId: null,
      queueType: queueTypeForMenuOption(5),
      clearQueue: false,
      triageCompleted: false,
      appendOutOfHours: false,
      reason: "supermarket_financial_intent",
    };
  }

  const productQuery = hasAny(normalized, [
    "tem o produto",
    "tem produto",
    "tem disponivel",
    "disponibilidade",
    "estoque",
    "qual o preco",
    "quanto custa",
    "valor do",
    "produto",
  ]);
  if (productQuery) {
    return {
      handled: true,
      kind: "collect-details",
      replyText: collectDetailsReply(presetEntry(3), config),
      queueMenuOption: 3,
      queueId: null,
      queueType: queueTypeForMenuOption(3),
      clearQueue: false,
      triageCompleted: false,
      appendOutOfHours: false,
      reason: "supermarket_product_intent",
    };
  }

  if (params.triageCompleted) {
    return {
      handled: true,
      kind: "silent-human",
      replyText: null,
      queueMenuOption: params.currentQueueMenuOption || null,
      queueId: null,
      queueType: null,
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: false,
      reason: "supermarket_message_waiting_for_human",
    };
  }

  if (config.aiFallbackEnabled) return null;
  return menuDecision(config, params.customerName, params.businessOpen, activeMenuOptions);
}

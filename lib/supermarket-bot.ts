import { SUPERMARKET_QUEUE_PRESET, getSupermarketPresetByOption } from "./supermarket-config";

export type SupermarketBotConfig = {
  enabled: boolean;
  botName: string;
  storeName: string;
  address: string | null;
  mapsUrl: string | null;
  weekdayHours: string | null;
  sundayHours: string | null;
  offersUrl: string | null;
  orderUrl: string | null;
  deliveryInfo: string | null;
  phone: string | null;
  aiFallbackEnabled: boolean;
};

export type SupermarketBotDecision = {
  handled: true;
  kind: "menu" | "self-service" | "collect-details" | "human-handoff" | "silent-human";
  replyText: string | null;
  queueMenuOption: number | null;
  clearQueue: boolean;
  triageCompleted: boolean;
  appendOutOfHours: boolean;
  reason: string;
};

export type DecideSupermarketBotParams = {
  message: string;
  customerName?: string | null;
  isNewConversation: boolean;
  triageCompleted: boolean;
  currentQueueMenuOption?: number | null;
  businessOpen: boolean;
  config?: SupermarketBotConfig;
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
    botName: optionalEnv("SUPERMARKET_BOT_NAME") || "Mavi",
    storeName: optionalEnv("SUPERMARKET_NAME") || "Supermercado",
    address: optionalEnv("SUPERMARKET_ADDRESS"),
    mapsUrl: optionalEnv("SUPERMARKET_MAPS_URL"),
    weekdayHours: optionalEnv("SUPERMARKET_HOURS_WEEKDAYS"),
    sundayHours: optionalEnv("SUPERMARKET_HOURS_SUNDAY"),
    offersUrl: optionalEnv("SUPERMARKET_OFFERS_URL"),
    orderUrl: optionalEnv("SUPERMARKET_ORDER_URL"),
    deliveryInfo: optionalEnv("SUPERMARKET_DELIVERY_INFO"),
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

function navigationFooter() {
  return "\n\nDigite *0* para voltar ao menu ou *7* para falar com a nossa equipe.";
}

export function buildSupermarketMenu(
  config: SupermarketBotConfig,
  customerName?: string | null,
  businessOpen = true,
): string {
  const name = firstName(customerName);
  const greeting = `${greetingByBrasiliaTime()}${name ? `, ${name}` : ""}! 👋`;
  const options = SUPERMARKET_QUEUE_PRESET.map(
    (item) => `${item.emoji} *${item.menuOption}* - ${item.name}`,
  ).join("\n");
  const availability = businessOpen
    ? "🟢 _Nossa equipe está disponível agora._"
    : "🌙 _Sua mensagem será registrada e respondida no próximo atendimento._";

  return (
    `${greeting}\n\n` +
    `Eu sou a *${config.botName}*, assistente virtual do *${config.storeName}*. ` +
    "Posso te ajudar rapidinho.\n\n" +
    options +
    "\n\nVocê também pode escrever o que precisa com suas próprias palavras." +
    "\nDigite *0* a qualquer momento para ver este menu novamente." +
    `\n\n${availability}`
  );
}

function offersReply(config: SupermarketBotConfig): string {
  const destination = config.offersUrl
    ? `Veja as ofertas atualizadas aqui:\n${config.offersUrl}`
    : "Nossas ofertas mudam ao longo da semana. O link do encarte ainda não foi configurado; nossa equipe pode enviar as promoções atuais para você.";
  return `🏷️ *Ofertas e promoções*\n\n${destination}${navigationFooter()}`;
}

function locationReply(config: SupermarketBotConfig): string {
  const hours = [config.weekdayHours, config.sundayHours].filter(Boolean).join("\n");
  const lines = [
    "📍 *Horários e localização*",
    "",
    hours || "O horário de funcionamento ainda não foi configurado no bot.",
    config.address ? `\n*Endereço:* ${config.address}` : "\nO endereço da unidade ainda não foi configurado no bot.",
    config.mapsUrl ? `\n*Como chegar:* ${config.mapsUrl}` : "",
    config.phone ? `\n*Telefone:* ${config.phone}` : "",
  ];
  return `${lines.join("\n").trim()}${navigationFooter()}`;
}

function deliveryReply(config: SupermarketBotConfig): string {
  const lines = [
    "🛵 *Entregas e pedidos*",
    "",
    config.deliveryInfo || "Consulte a disponibilidade, a taxa e a área de entrega com a nossa equipe.",
    config.orderUrl ? `\n*Faça seu pedido:* ${config.orderUrl}` : "",
    "\nSe você já fez um pedido e precisa de ajuda, escreva *problema com pedido*.",
  ];
  return `${lines.join("\n").trim()}${navigationFooter()}`;
}

function collectDetailsReply(menuOption: number): string {
  if (menuOption === 4) {
    return (
      "🛒 *Consulta de produto*\n\n" +
      "Envie o *nome do produto*, a *marca* e o *tamanho ou peso* que procura.\n" +
      "Exemplo: _Café Melitta, pacote de 500 g_.\n\n" +
      "Um atendente confirmará preço e disponibilidade — o bot não inventa informações de estoque."
    );
  }
  if (menuOption === 5) {
    return (
      "🥩 *Setores frescos*\n\n" +
      "Diga qual setor e item você procura.\n" +
      "Exemplo: _Açougue — 2 kg de alcatra_ ou _Padaria — encomenda de bolo_."
    );
  }
  return (
    "💳 *Trocas, devoluções e pagamentos*\n\n" +
    "Conte resumidamente o que aconteceu. Se tiver, informe também o número do cupom, pedido ou comprovante.\n\n" +
    "Não envie senha, código do cartão ou outros dados bancários sensíveis."
  );
}

function detailsReceivedReply(menuOption: number, message: string): string {
  const preset = getSupermarketPresetByOption(menuOption);
  const summary = message.trim().replace(/\s+/g, " ").slice(0, 220);
  return (
    `✅ Obrigado! Registrei sua solicitação em *${preset?.name || "Atendimento"}*.\n\n` +
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
  const match = normalized.match(/^(?:opcao\s*)?([0-7])$/);
  return match ? Number(match[1]) : null;
}

function menuDecision(config: SupermarketBotConfig, customerName: string | null | undefined, businessOpen: boolean): SupermarketBotDecision {
  return {
    handled: true,
    kind: "menu",
    replyText: buildSupermarketMenu(config, customerName, businessOpen),
    queueMenuOption: null,
    clearQueue: true,
    triageCompleted: false,
    appendOutOfHours: false,
    reason: "supermarket_main_menu",
  };
}

function optionDecision(
  option: number,
  config: SupermarketBotConfig,
): SupermarketBotDecision {
  if (option === 1 || option === 2 || option === 3) {
    const missingSelfServiceData =
      (option === 1 && !config.offersUrl) ||
      (option === 2 && !config.weekdayHours && !config.sundayHours && !config.address && !config.mapsUrl) ||
      (option === 3 && !config.deliveryInfo && !config.orderUrl);
    if (missingSelfServiceData) {
      const context =
        option === 1
          ? "Quero receber as ofertas e promoções atuais."
          : option === 2
            ? "Preciso confirmar o horário ou a localização da loja."
            : "Quero informações sobre entrega ou fazer um pedido.";
      return {
        handled: true,
        kind: "human-handoff",
        replyText: humanHandoffReply(config, context),
        queueMenuOption: option,
        clearQueue: false,
        triageCompleted: true,
        appendOutOfHours: true,
        reason: `supermarket_missing_self_service_config_${option}`,
      };
    }

    const replyText = option === 1 ? offersReply(config) : option === 2 ? locationReply(config) : deliveryReply(config);
    return {
      handled: true,
      kind: "self-service",
      replyText,
      queueMenuOption: null,
      clearQueue: true,
      triageCompleted: false,
      appendOutOfHours: false,
      reason: `supermarket_self_service_${option}`,
    };
  }

  if (option >= 4 && option <= 6) {
    return {
      handled: true,
      kind: "collect-details",
      replyText: collectDetailsReply(option),
      queueMenuOption: option,
      clearQueue: false,
      triageCompleted: false,
      appendOutOfHours: false,
      reason: `supermarket_collect_details_${option}`,
    };
  }

  return {
    handled: true,
    kind: "human-handoff",
    replyText: humanHandoffReply(config),
    queueMenuOption: 7,
    clearQueue: false,
    triageCompleted: true,
    appendOutOfHours: true,
    reason: "supermarket_human_requested",
  };
}

export function decideSupermarketBot(params: DecideSupermarketBotParams): SupermarketBotDecision | null {
  const config = params.config || getSupermarketBotConfig();
  if (!config.enabled) return null;

  const rawMessage = String(params.message || "").trim();
  const normalized = normalizeText(rawMessage);
  const option = selectedMenuOption(normalized);

  const isMenuCommand =
    option === 0 ||
    hasAny(normalized, ["voltar ao menu", "menu principal", "ver menu", "inicio", "comecar de novo"]) ||
    /^(oi|ola|bom dia|boa tarde|boa noite|menu)$/.test(normalized);
  if (isMenuCommand) {
    return menuDecision(config, params.customerName, params.businessOpen);
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
  if (wantsHuman || option === 7) {
    return optionDecision(7, config);
  }

  if (option !== null) {
    return optionDecision(option, config);
  }

  if (
    !params.triageCompleted &&
    params.currentQueueMenuOption &&
    [4, 5, 6].includes(params.currentQueueMenuOption)
  ) {
    return {
      handled: true,
      kind: "human-handoff",
      replyText: detailsReceivedReply(params.currentQueueMenuOption, rawMessage),
      queueMenuOption: params.currentQueueMenuOption,
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: true,
      reason: `supermarket_details_received_${params.currentQueueMenuOption}`,
    };
  }

  const orderProblem = hasAny(normalized, [
    "pedido atrasado",
    "pedido nao chegou",
    "problema com pedido",
    "pedido errado",
    "faltou no pedido",
    "acompanhar pedido",
    "status do pedido",
  ]);
  if (orderProblem) {
    return {
      handled: true,
      kind: "human-handoff",
      replyText: humanHandoffReply(config, rawMessage),
      queueMenuOption: 3,
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: true,
      reason: "supermarket_order_problem",
    };
  }

  if (hasAny(normalized, ["oferta", "ofertas", "promocao", "promocoes", "encarte", "desconto"])) {
    return optionDecision(1, config);
  }

  if (hasAny(normalized, ["horario", "abre", "fecha", "funcionamento", "endereco", "localizacao", "como chegar"])) {
    return optionDecision(2, config);
  }

  if (hasAny(normalized, ["entrega", "delivery", "fazer pedido", "comprar online", "taxa de entrega"])) {
    return optionDecision(3, config);
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
      replyText: collectDetailsReply(5),
      queueMenuOption: 5,
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
      replyText: collectDetailsReply(6),
      queueMenuOption: 6,
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
      replyText: collectDetailsReply(4),
      queueMenuOption: 4,
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
      clearQueue: false,
      triageCompleted: true,
      appendOutOfHours: false,
      reason: "supermarket_message_waiting_for_human",
    };
  }

  if (config.aiFallbackEnabled) return null;
  return menuDecision(config, params.customerName, params.businessOpen);
}

import { defaultTimeZone, zonedParts } from "@/lib/timezone";

export const DEFAULT_ORGANIZATION_ID = process.env.DEFAULT_ORG_ID || "org_willtalk_default";

/**
 * Compara minutos do dia, não instantes: quem chama já resolveu o fuso da loja.
 * A versão anterior usava `Date#getHours`, ou seja, o relógio do servidor — em
 * produção (UTC) o expediente era avaliado três horas adiantado.
 */
export function isInsideTimeRange(minutesOfDay: number, startTime: string, endTime: string) {
  const [startHour, startMin] = startTime.split(":").map(Number);
  const [endHour, endMin] = endTime.split(":").map(Number);
  const start = startHour * 60 + startMin;
  const end = endHour * 60 + endMin;

  return minutesOfDay >= start && minutesOfDay <= end;
}

export function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, "").trim();
}

/**
 * Identificador canônico usado para autorização e isolamento. Não conserva
 * prefixos de transporte como `whatsapp:` ou sufixos do whatsapp-web.js.
 */
export function normalizePhoneDigits(phone: string): string {
  const raw = String(phone || "").trim();
  const explicitInternational =
    /^(?:whatsapp:)?\s*\+/i.test(raw) || /^00/.test(raw);
  let digits = raw.replace(/\D/g, "");
  // Aceita o prefixo internacional discado (00) sem transformá-lo em parte do DDI.
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length > 10) {
    digits = digits.slice(1);
  }
  if (!explicitInternational && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  if (digits.length < 10 || digits.length > 15) {
    return "";
  }
  return digits;
}

/**
 * Possíveis endereços E.164 para consulta no WhatsApp.
 *
 * No Brasil há contas antigas cujo JID ainda usa o número sem o nono dígito. O
 * `onWhatsApp` é a autoridade para decidir qual candidato existe; a aplicação não
 * deve escolher no escuro nem reconstruir o JID depois dessa consulta.
 */
export function whatsappPhoneCandidates(phone: string): string[] {
  const primary = normalizePhoneDigits(phone);
  if (!primary) return [];

  const candidates = [primary];
  if (primary.startsWith("55")) {
    const national = primary.slice(2);
    const ddd = national.slice(0, 2);
    const subscriber = national.slice(2);

    if (ddd.length === 2 && subscriber.length === 8) {
      candidates.push(`55${ddd}9${subscriber}`);
    } else if (
      ddd.length === 2 &&
      subscriber.length === 9 &&
      subscriber.startsWith("9")
    ) {
      candidates.push(`55${ddd}${subscriber.slice(1)}`);
    }
  }

  return [...new Set(candidates)].filter(
    (candidate) => /^\d{10,15}$/.test(candidate),
  );
}

/** Formatos históricos aceitos ao procurar um contato já salvo no banco. */
export function whatsappPhoneStorageAliases(phone: string): string[] {
  const raw = String(phone || "").trim();
  const [canonicalDigits, ...legacyBrazilianVariants] =
    whatsappPhoneCandidates(phone);
  const aliases = canonicalDigits
    ? [
        canonicalDigits,
        `+${canonicalDigits}`,
        `whatsapp:${canonicalDigits}`,
        `whatsapp:+${canonicalDigits}`,
      ]
    : [];
  // A versão antiga da "Nova conversa" só gravava dígitos. Consultamos a variação
  // brasileira apenas nesses formatos legados; nunca fundimos dois contatos
  // canônicos `whatsapp:+...` que possam representar contas realmente distintas.
  for (const digits of legacyBrazilianVariants) {
    aliases.push(digits, `+${digits}`);
  }
  if (raw) aliases.push(raw);
  return [...new Set(aliases)];
}

export function toWhatsAppAddress(phone: string): string {
  const digits = normalizePhoneDigits(phone);
  return digits ? `whatsapp:+${digits}` : "";
}

/** Saudação pelo relógio da loja, nunca pelo do servidor (UTC em produção). */
function getGreetingByStoreTime(date = new Date()): string {
  const { hour } = zonedParts(date, defaultTimeZone());
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function buildDemandMenu(
  options: Array<{ menuOption: number; name: string }>,
  clienteNome?: string | null,
) {
  const lines = options
    .sort((a, b) => a.menuOption - b.menuOption)
    .map((option) => `*${option.menuOption}* - ${option.name}`)
    .join("\n");
  const greeting = getGreetingByStoreTime();
  const nome = String(clienteNome || "").trim();
  const saudacao = nome ? `${greeting}, ${nome}!` : `${greeting}!`;

  return (
    `${saudacao} 👋\n` +
    "Sou a assistente virtual da Mavo AI e vou agilizar seu atendimento.\n\n" +
    "Escolha uma opcao respondendo apenas com o numero:\n\n" +
    lines +
    "\n\nSe preferir, descreva seu problema em uma frase e eu classifico para voce."
  );
}

export function buildTriageConfirmation(queueName: string): string {
  return (
    `\u{2705} Sua solicitação de *${queueName}* foi registrada com sucesso.\n\n` +
    "Nossa equipe já foi notificada e seu atendimento está na fila.\n" +
    "Em breve um atendente irá te responder."
  );
}

export function buildTriageInvalidAttempt(
  options: Array<{ menuOption: number; name: string }>,
  attempt: number,
  maxAttempts: number,
): string {
  const lines = options
    .sort((a, b) => a.menuOption - b.menuOption)
    .map((o) => `*${o.menuOption}* - ${o.name}`)
    .join("\n");

  return (
    `\u{274C} Não conseguimos identificar uma opção válida.\n\n` +
    "Por favor, escolha uma das opções abaixo:\n\n" +
    lines +
    "\n\n_Responda apenas com o número da opção desejada._" +
    `\n\n_Tentativa ${attempt}/${maxAttempts}_`
  );
}

export function buildTriageHumanHandoff(): string {
  return (
    "\u{26A0}\u{FE0F} Não conseguimos identificar sua solicitação.\n\n" +
    "Você será encaminhado(a) para um atendente humano que irá te ajudar.\n" +
    "Aguarde, por favor."
  );
}

export function buildTriageNoQueues(): string {
  return (
    "\u{2705} Sua mensagem foi recebida e registrada.\n\n" +
    "No momento não há opções de atendimento automático.\n" +
    "Um atendente responderá em breve."
  );
}

export function buildTriageRatingThanks(): string {
  return (
    "\u{2B50} Obrigado pela sua avaliação!\n\n" +
    "Ela é muito importante para melhorarmos nosso atendimento."
  );
}

/** Mensagem curta após triagem concluída: cliente continua recebendo retorno automático até o humano assumir. */
export function buildPostTriageClientAck(): string {
  return (
    "\u{2705} Recebemos sua mensagem.\n\n" +
    "Um atendente já pode ver o que você enviou e responderá por aqui em breve.\n" +
    "Se for urgente, aguarde na conversa."
  );
}

export function buildOutOfHoursNotice(): string {
  return (
    "\n\n\u{1F553} _Estamos fora do horário comercial. " +
    "Responderemos no próximo expediente._"
  );
}

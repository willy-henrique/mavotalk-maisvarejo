export type SupermarketSettingsPatch = {
  enabled?: boolean;
  aiFallbackEnabled?: boolean;
  botName?: string;
  storeName?: string;
  address?: string | null;
  mapsUrl?: string | null;
  weekdayHours?: string | null;
  sundayHours?: string | null;
  offersUrl?: string | null;
  offersText?: string | null;
  phone?: string | null;
};

type ParseResult = { data: SupermarketSettingsPatch; error?: string };
export type BusinessHourPatch = {
  weekday: number;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
};

function text(value: unknown, max: number): string | null {
  if (value == null) return null;
  const result = String(value).trim();
  return result ? result.slice(0, max) : null;
}

function safeHttpUrl(value: unknown, label: string): { value: string | null; error?: string } {
  const normalized = text(value, 1000);
  if (!normalized) return { value: null };
  try {
    const url = new URL(normalized);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { value: null, error: `${label} deve usar http ou https.` };
    }
    return { value: normalized };
  } catch {
    return { value: null, error: `${label} é inválido.` };
  }
}

/**
 * Normaliza a parcela editável das configurações do bot. A rota ainda resolve
 * o tenant pela sessão; este parser apenas impede que a identidade pública ou
 * links inseridos no WhatsApp sejam persistidos em um formato inseguro.
 */
export function parseSupermarketSettingsPatch(body: Record<string, unknown>): ParseResult {
  const data: SupermarketSettingsPatch = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.aiFallbackEnabled === "boolean") data.aiFallbackEnabled = body.aiFallbackEnabled;

  const requiredIdentity = [
    ["botName", "Nome do assistente", 80],
    ["storeName", "Nome do supermercado", 160],
  ] as const;
  for (const [key, label, max] of requiredIdentity) {
    if (!(key in body)) continue;
    const value = text(body[key], max);
    if (!value) return { data, error: `${label} é obrigatório.` };
    data[key] = value;
  }

  for (const [key, max] of [
    ["address", 300],
    ["weekdayHours", 160],
    ["sundayHours", 160],
    ["offersText", 4000],
    ["phone", 40],
  ] as const) {
    if (key in body) data[key] = text(body[key], max);
  }

  for (const [key, label] of [
    ["mapsUrl", "Link do mapa"],
    ["offersUrl", "Link do encarte"],
  ] as const) {
    if (!(key in body)) continue;
    const parsed = safeHttpUrl(body[key], label);
    if (parsed.error) return { data, error: parsed.error };
    data[key] = parsed.value;
  }

  return { data };
}

const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Horários fora do expediente são avaliados pelo bot no fuso da operação. */
export function parseBusinessHoursPatch(value: unknown): { data?: BusinessHourPatch[]; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: "Horários de funcionamento devem ser uma lista." };

  const weekdays = new Set<number>();
  const data: BusinessHourPatch[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return { error: "Cada horário de funcionamento deve ser válido." };
    const row = item as Record<string, unknown>;
    const weekday = Number(row.weekday);
    const startTime = String(row.startTime || "");
    const endTime = String(row.endTime || "");
    const isActive = row.isActive !== false;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || weekdays.has(weekday)) {
      return { error: "Cada dia da semana deve aparecer uma única vez." };
    }
    if (!VALID_TIME.test(startTime) || !VALID_TIME.test(endTime)) {
      return { error: "Informe horários válidos no formato HH:MM." };
    }
    if (isActive && minutes(startTime) >= minutes(endTime)) {
      return { error: "O horário de abertura deve ser anterior ao horário de fechamento." };
    }
    const timezone = String(row.timezone || "America/Sao_Paulo");
    if (timezone !== "America/Sao_Paulo") {
      return { error: "O fuso horário da operação deve ser America/Sao_Paulo." };
    }
    weekdays.add(weekday);
    data.push({ weekday, startTime, endTime, timezone, isActive });
  }
  return { data };
}

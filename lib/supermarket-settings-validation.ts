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

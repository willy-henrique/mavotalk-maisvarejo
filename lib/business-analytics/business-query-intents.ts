import type { BusinessQueryIntent } from "@/lib/business-analytics/types";

export const BUSINESS_MENU = [
  "1 — Resumo de vendas",
  "2 — Total vendido",
  "3 — Produtos mais vendidos",
  "4 — Média de vendas por dia",
  "5 — Vendas por data",
  "6 — Vendas por dia da semana",
  "7 — Entradas de estoque",
  "8 — Produtos com menor venda",
  "9 — Comparar períodos",
  "10 — Fazer uma pergunta sobre o negócio",
] as const;

const menuIntents: Record<string, BusinessQueryIntent> = {
  "1": "business_summary",
  "2": "sales_total",
  "3": "top_selling_products",
  "4": "average_daily_sales",
  "5": "sales_by_day",
  "6": "sales_by_weekday",
  "7": "inventory_entries",
  "8": "low_selling_products",
  "9": "compare_sales_periods",
  "10": "help",
};

export function normalizeBusinessInput(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[?!.,;:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseBusinessIntent(input: string): BusinessQueryIntent {
  const normalized = normalizeBusinessInput(input);
  if (menuIntents[normalized]) return menuIntents[normalized];
  if (!normalized || /^(menu|ajuda|opcoes)$/.test(normalized)) return "help";
  if (/(atualiza|sincroniza|dados recentes|ultima carga)/.test(normalized)) {
    return "data_freshness";
  }
  if (/(compar|versus|diferenca|cresceu|caiu)/.test(normalized)) {
    return "compare_sales_periods";
  }
  if (/(entrada|estoque|recebimento de produto)/.test(normalized)) {
    return "inventory_entries";
  }
  if (/(sem venda|menos vend|menor venda|baixo giro|encalhad)/.test(normalized)) {
    return "low_selling_products";
  }
  if (/(mais vend|top produto|ranking|produto campeao)/.test(normalized)) {
    return "top_selling_products";
  }
  if (/(dia da semana|segunda|terca|quarta|quinta|sexta|sabado|domingo)/.test(normalized)) {
    return "sales_by_weekday";
  }
  if (/(ticket medio|valor medio por venda)/.test(normalized)) {
    return "average_ticket";
  }
  if (/(media.*dia|media diaria)/.test(normalized)) {
    return "average_daily_sales";
  }
  if (/(quantidade de vendas|quantas vendas|numero de vendas)/.test(normalized)) {
    return "sales_count";
  }
  if (/(por data|por dia|evolucao|historico de vendas)/.test(normalized)) {
    return "sales_by_day";
  }
  if (/(resumo|visao geral|como esta o negocio)/.test(normalized)) {
    return "business_summary";
  }
  if (/(total vend|quanto vende|faturamento|vendas de)/.test(normalized)) {
    return "sales_total";
  }
  return "unknown";
}

export function requestedLimit(input: string, fallback = 5): number {
  const normalized = normalizeBusinessInput(input);
  const match =
    normalized.match(/\btop\s*(\d{1,2})\b/) ||
    normalized.match(/\b(?:os|as|primeiros?|primeiras?)\s*(\d{1,2})\s+produtos?\b/) ||
    normalized.match(/\b(\d{1,2})\s+produtos?\b/);
  if (!match) return fallback;
  return Math.min(20, Math.max(1, Number(match[1])));
}

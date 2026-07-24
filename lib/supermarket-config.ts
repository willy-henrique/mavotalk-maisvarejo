export type SupermarketQueuePresetItem = {
  menuOption: number;
  name: string;
  colorHex: string;
  defaultSlaMins: number;
  emoji: string;
  mode: "self-service" | "assisted" | "human";
};

/**
 * Modelo oficial de atendimento para supermercados.
 * As opções 1–3 resolvem dúvidas recorrentes sem ocupar um atendente.
 * As opções 4–7 preservam contexto e encaminham para a fila responsável.
 */
export const SUPERMARKET_QUEUE_PRESET: readonly SupermarketQueuePresetItem[] = [
  {
    menuOption: 1,
    name: "Ofertas e promoções",
    colorHex: "#F97316",
    defaultSlaMins: 5,
    emoji: "🏷️",
    mode: "self-service",
  },
  {
    menuOption: 2,
    name: "Horários e localização",
    colorHex: "#3B82F6",
    defaultSlaMins: 5,
    emoji: "📍",
    mode: "self-service",
  },
  {
    menuOption: 3,
    name: "Entregas e pedidos",
    colorHex: "#8B5CF6",
    defaultSlaMins: 10,
    emoji: "🛵",
    mode: "self-service",
  },
  {
    menuOption: 4,
    name: "Produtos e disponibilidade",
    colorHex: "#14B8A6",
    defaultSlaMins: 15,
    emoji: "🛒",
    mode: "assisted",
  },
  {
    menuOption: 5,
    name: "Açougue, padaria e hortifruti",
    colorHex: "#22C55E",
    defaultSlaMins: 15,
    emoji: "🥩",
    mode: "assisted",
  },
  {
    menuOption: 6,
    name: "Trocas, devoluções e pagamentos",
    colorHex: "#EAB308",
    defaultSlaMins: 20,
    emoji: "💳",
    mode: "assisted",
  },
  {
    menuOption: 7,
    name: "Falar com um atendente",
    colorHex: "#EF4444",
    defaultSlaMins: 10,
    emoji: "🙋",
    mode: "human",
  },
] as const;

export function getSupermarketPresetByOption(menuOption: number) {
  return SUPERMARKET_QUEUE_PRESET.find((item) => item.menuOption === menuOption) || null;
}

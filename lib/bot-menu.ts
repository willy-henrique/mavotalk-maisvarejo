import type { QueueAutomationType } from "@/lib/queue-automation-schemas";

/**
 * Uma opção do menu que o cliente recebe no WhatsApp, derivada da fila
 * cadastrada pelo tenant. O comportamento do bot é decidido pelo `queueType`,
 * nunca pela posição no menu: assim uma fila de ofertas continua entregando os
 * encartes mesmo que o administrador a mova para outra posição.
 */
export type BotMenuEntry = {
  queueId: string;
  menuOption: number;
  name: string;
  queueType: QueueAutomationType;
};

/** Comprimento mínimo para casar uma opção pelo nome, evitando que uma letra solta selecione uma fila. */
const MIN_NAME_MATCH_LENGTH = 3;

export function normalizeMenuText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function byMenuOption(a: BotMenuEntry, b: BotMenuEntry) {
  return a.menuOption - b.menuOption;
}

export function sortMenuEntries(entries: readonly BotMenuEntry[]): BotMenuEntry[] {
  return [...entries].sort(byMenuOption);
}

/** Renderiza as opções como `*N* - Nome`, na ordem configurada no painel. */
export function renderMenuOptions(entries: readonly BotMenuEntry[]): string {
  return sortMenuEntries(entries)
    .map((entry) => `*${entry.menuOption}* - ${entry.name}`)
    .join("\n");
}

function onlyMatch(candidates: readonly BotMenuEntry[]): BotMenuEntry | null {
  return candidates.length === 1 ? candidates[0] : null;
}

/**
 * Resolve a escolha do cliente por número ou pelo nome da opção. O casamento por
 * nome exige um resultado único: "nota fiscal" com as filas de Entrada e Saída
 * ativas é ambíguo, e devolver `null` faz o bot reexibir o menu em vez de
 * adivinhar a fila errada.
 */
export function matchMenuEntry(
  text: string,
  entries: readonly BotMenuEntry[],
): BotMenuEntry | null {
  const normalized = normalizeMenuText(text);
  if (!normalized) return null;

  const numeric = normalized.match(/^(?:opcao\s*)?(\d{1,3})$/);
  if (numeric) {
    const option = Number(numeric[1]);
    return entries.find((entry) => entry.menuOption === option) || null;
  }

  if (normalized.length < MIN_NAME_MATCH_LENGTH) return null;

  const named = entries.map((entry) => ({ entry, name: normalizeMenuText(entry.name) }));

  const exact = named.filter((item) => item.name === normalized);
  if (exact.length) return exact[0].entry;

  const prefixed = named.filter((item) => item.name.startsWith(normalized));
  return onlyMatch(prefixed.map((item) => item.entry));
}

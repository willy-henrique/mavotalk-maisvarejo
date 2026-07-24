import { mavoConfig } from "@/lib/config/mavo-config";
import { BUSINESS_MENU } from "@/lib/business-analytics/business-query-intents";
import type {
  AverageDailySalesResult,
  AverageTicketResult,
  BusinessSummary,
  DataFreshness,
  InventoryEntryItem,
  ProductSalesItem,
  SalesByDayItem,
  SalesByWeekdayItem,
  SalesComparison,
  SalesTotals,
} from "@/lib/business-analytics/types";

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: mavoConfig.defaultCurrency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

export function formatTimestamp(value: string | null): string {
  if (!value) return "não disponível";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: mavoConfig.defaultTimezone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function businessMenu(name?: string): string {
  const greeting = name
    ? `Olá, ${name}. Acesso gerencial confirmado.`
    : "Acesso gerencial confirmado.";
  return `${greeting}

O que deseja consultar?

${BUSINESS_MENU.join("\n")}

Você também pode escrever sua pergunta.
Digite “sair” para encerrar a sessão.
Digite “suporte” para abrir um atendimento.`;
}

export function pinChallengeMessage(): string {
  return "Para continuar com segurança, digite seu PIN gerencial de 6 ou mais dígitos.";
}

export function noDataMessage(freshness: DataFreshness): string {
  return freshness.lastSourceUpdate
    ? `Ainda não há dados sincronizados para esse período. A última atualização ocorreu em ${formatTimestamp(freshness.lastSourceUpdate)}.`
    : "Ainda não há dados sincronizados para esse período.";
}

export function formatSalesTotals(value: SalesTotals): string {
  return `Vendas — ${value.period.label}

Total vendido: ${formatCurrency(value.netTotal)}
Quantidade de vendas: ${formatQuantity(value.salesCount)}
Itens vendidos: ${formatQuantity(value.itemsQuantity)}`;
}

export function formatSalesCount(value: {
  period: { label: string };
  salesCount: number;
}): string {
  return `Quantidade de vendas — ${value.period.label}

${formatQuantity(value.salesCount)} vendas.`;
}

export function formatAverageTicket(value: AverageTicketResult): string {
  return `Ticket médio — ${value.period.label}

${formatCurrency(value.averageTicket)}
Base: ${formatQuantity(value.salesCount)} vendas.`;
}

export function formatAverageDaily(value: AverageDailySalesResult): string {
  const coverage =
    value.synchronizedDays < value.calendarDays
      ? `\nAtenção: há dados em ${value.synchronizedDays} de ${value.calendarDays} dias.`
      : "";
  return `Média de vendas por dia — ${value.period.label}

${formatCurrency(value.averagePerDay)}
Total do período: ${formatCurrency(value.netTotal)}.${coverage}`;
}

export function formatSalesByDay(
  periodLabel: string,
  items: SalesByDayItem[],
): string {
  const lines = items
    .slice(0, 10)
    .map(
      (item) =>
        `${formatDate(item.date)}: ${formatCurrency(item.netTotal)} (${formatQuantity(item.salesCount)} vendas)`,
    );
  return `Vendas por data — ${periodLabel}\n\n${lines.join("\n")}${
    items.length > 10 ? "\n\nMostrando os 10 dias mais recentes." : ""
  }`;
}

export function formatSalesByWeekday(
  periodLabel: string,
  items: SalesByWeekdayItem[],
): string {
  const lines = items
    .slice(0, 7)
    .map(
      (item, index) =>
        `${index + 1}. ${item.weekdayName}: ${formatCurrency(item.netTotal)}`,
    );
  return `Vendas por dia da semana — ${periodLabel}\n\n${lines.join("\n")}`;
}

export function formatProductRanking(
  title: string,
  periodLabel: string,
  items: ProductSalesItem[],
): string {
  const lines = items
    .slice(0, 10)
    .map(
      (item, index) =>
        `${index + 1}. ${item.productName} — ${formatQuantity(item.quantity)} un.`,
    );
  return `${title} — ${periodLabel}\n\n${lines.join("\n")}`;
}

export function formatInventoryEntries(
  periodLabel: string,
  items: InventoryEntryItem[],
): string {
  const lines = items
    .slice(0, 10)
    .map(
      (item, index) =>
        `${index + 1}. ${item.productName} — ${formatQuantity(item.quantityEntered)} un.`,
    );
  return `Entradas de estoque — ${periodLabel}\n\n${lines.join("\n")}`;
}

function variationText(value: number | null): string {
  if (value == null) return "sem base anterior para percentual";
  const direction = value > 0 ? "alta" : value < 0 ? "queda" : "estável";
  return `${direction} de ${new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
  }).format(Math.abs(value))}%`;
}

export function formatComparison(value: SalesComparison): string {
  return `Comparação de vendas

${value.current.period.label}: ${formatCurrency(value.current.netTotal)}
${value.previous.period.label}: ${formatCurrency(value.previous.netTotal)}

Resultado: ${variationText(value.netTotalVariationPercent)}.
Vendas: ${variationText(value.salesCountVariationPercent)}.`;
}

export function formatBusinessSummary(value: BusinessSummary): string {
  return `Resumo de vendas — ${value.totals.period.label}

Total vendido: ${formatCurrency(value.totals.netTotal)}
Quantidade de vendas: ${formatQuantity(value.totals.salesCount)}
Ticket médio: ${formatCurrency(value.averageTicket)}
Média por dia: ${formatCurrency(value.averagePerDay)}
Produto mais vendido: ${value.topProduct?.productName || "não disponível"}
Melhor dia da semana: ${value.bestWeekday?.weekdayName || "não disponível"}

Dados atualizados em: ${formatTimestamp(value.lastDataUpdate)}.`;
}

export function formatFreshness(value: DataFreshness): string {
  return `Atualização dos dados

Último dado recebido: ${formatTimestamp(value.lastSourceUpdate)}
Última sincronização do agente: ${formatTimestamp(value.lastAgentSync)}
Estado do agente: ${value.agentStatus || "não disponível"}.`;
}

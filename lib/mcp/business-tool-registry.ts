import { assertBusinessPermission } from "@/lib/business-access/business-permissions";
import type { BusinessAnalyticsContext } from "@/lib/business-analytics/types";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { getSalesTotalTool } from "@/lib/mcp/tools/get-sales-total";
import { getSalesCountTool } from "@/lib/mcp/tools/get-sales-count";
import { getAverageTicketTool } from "@/lib/mcp/tools/get-average-ticket";
import { getAverageDailySalesTool } from "@/lib/mcp/tools/get-average-daily-sales";
import { getSalesByDayTool } from "@/lib/mcp/tools/get-sales-by-day";
import { getSalesByWeekdayTool } from "@/lib/mcp/tools/get-sales-by-weekday";
import { getTopProductsTool } from "@/lib/mcp/tools/get-top-products";
import { getLowSellingProductsTool } from "@/lib/mcp/tools/get-low-selling-products";
import { getInventoryEntriesTool } from "@/lib/mcp/tools/get-inventory-entries";
import { compareSalesPeriodsTool } from "@/lib/mcp/tools/compare-sales-periods";
import { getBusinessSummaryTool } from "@/lib/mcp/tools/get-business-summary";
import { getDataFreshnessTool } from "@/lib/mcp/tools/get-data-freshness";

export const businessTools: readonly BusinessToolDefinition[] = [
  getSalesTotalTool,
  getSalesCountTool,
  getAverageTicketTool,
  getAverageDailySalesTool,
  getSalesByDayTool,
  getSalesByWeekdayTool,
  getTopProductsTool,
  getLowSellingProductsTool,
  getInventoryEntriesTool,
  compareSalesPeriodsTool,
  getBusinessSummaryTool,
  getDataFreshnessTool,
];

const toolsByName = new Map(businessTools.map((tool) => [tool.name, tool]));

export function getBusinessTool(name: string): BusinessToolDefinition | null {
  return toolsByName.get(name) || null;
}

export async function invokeBusinessTool(
  name: string,
  context: BusinessAnalyticsContext,
  rawInput: unknown,
): Promise<unknown> {
  const tool = getBusinessTool(name);
  if (!tool) {
    const error = new Error("Ferramenta gerencial desconhecida");
    Object.assign(error, { code: "TOOL_NOT_FOUND", status: 404 });
    throw error;
  }
  assertBusinessPermission(context.permissions, tool.requiredPermission);
  const parsed = tool.inputSchema.safeParse(rawInput);
  if (!parsed.success) {
    const error = new Error("Parâmetros da ferramenta inválidos");
    Object.assign(error, {
      code: "INVALID_TOOL_ARGUMENTS",
      status: 400,
      issues: parsed.error.issues,
    });
    throw error;
  }
  return tool.execute(context, parsed.data as Record<string, unknown>);
}

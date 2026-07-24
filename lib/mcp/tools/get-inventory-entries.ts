import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { limitedPeriodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getInventoryEntriesTool: BusinessToolDefinition = {
  name: "get_inventory_entries",
  title: "Entradas de estoque",
  description: "Retorna entradas agregadas de estoque, somente leitura.",
  inputSchema: limitedPeriodInputSchema,
  requiredPermission: "inventory.read",
  execute: (context, input) =>
    businessAnalyticsService.getInventoryEntries(
      context,
      toolPeriod(input),
      Number(input.limit || 10),
    ),
};

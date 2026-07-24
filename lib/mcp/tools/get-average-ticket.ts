import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { periodInputSchema, toolPeriod } from "@/lib/mcp/tools/shared";

export const getAverageTicketTool: BusinessToolDefinition = {
  name: "get_average_ticket",
  title: "Ticket médio",
  description: "Calcula o ticket médio usando dados agregados autorizados.",
  inputSchema: periodInputSchema,
  requiredPermission: "finance.read",
  execute: (context, input) =>
    businessAnalyticsService.getAverageTicket(context, toolPeriod(input)),
};

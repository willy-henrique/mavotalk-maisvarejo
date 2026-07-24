import { z } from "zod";
import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";

export const getDataFreshnessTool: BusinessToolDefinition = {
  name: "get_data_freshness",
  title: "Atualização dos dados",
  description: "Informa a última sincronização e atualização, sem dados financeiros.",
  inputSchema: z.object({}).strict(),
  requiredPermission: "sales.read",
  execute: (context) => businessAnalyticsService.getDataFreshness(context),
};

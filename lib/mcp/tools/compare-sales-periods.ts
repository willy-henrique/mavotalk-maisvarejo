import { z } from "zod";
import { businessAnalyticsService } from "@/lib/business-analytics/business-analytics-service";
import type { BusinessToolDefinition } from "@/lib/mcp/types";
import { comparisonPeriods, periodInputSchema } from "@/lib/mcp/tools/shared";

const schema = periodInputSchema
  .extend({
    previousFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    previousTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .refine(
    (value) =>
      (!value.previousFrom && !value.previousTo) ||
      Boolean(value.previousFrom && value.previousTo),
    "previousFrom e previousTo devem ser enviados juntos",
  );

export const compareSalesPeriodsTool: BusinessToolDefinition = {
  name: "compare_sales_periods",
  title: "Comparação de vendas",
  description: "Compara dois períodos sem permitir mudança de tenant.",
  inputSchema: schema,
  requiredPermission: "finance.read",
  execute: (context, input) => {
    const periods = comparisonPeriods(input);
    return businessAnalyticsService.compareSalesPeriods(
      context,
      periods.current,
      periods.previous,
    );
  },
};

import type { z } from "zod";
import type { BusinessAnalyticsContext } from "@/lib/business-analytics/types";
import type { BusinessPermission } from "@/lib/business-access/types";

export type BusinessToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodType;
  requiredPermission: BusinessPermission;
  execute: (
    context: BusinessAnalyticsContext,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};

import { z } from "zod";
import { mavoConfig } from "@/lib/config/mavo-config";
import {
  businessPeriodFromIsoRange,
  parseBusinessPeriod,
  previousComparablePeriod,
} from "@/lib/business-analytics/business-period-parser";
import type { BusinessPeriod } from "@/lib/business-analytics/types";

export const periodInputSchema = z
  .object({
    period: z.string().min(1).max(100).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  })
  .strict()
  .refine(
    (value) => (!value.from && !value.to) || Boolean(value.from && value.to),
    "from e to devem ser enviados juntos",
  );

export const limitedPeriodInputSchema = periodInputSchema.extend({
  limit: z.number().int().min(1).max(20).default(10),
});

export function toolPeriod(input: {
  period?: string;
  from?: string;
  to?: string;
}): BusinessPeriod {
  if (input.from && input.to) {
    return businessPeriodFromIsoRange({
      from: input.from,
      to: input.to,
      label: `${input.from} a ${input.to}`,
      timezone: mavoConfig.defaultTimezone,
    });
  }
  return parseBusinessPeriod(input.period || "este mês", {
    timezone: mavoConfig.defaultTimezone,
  });
}

export function comparisonPeriods(input: {
  period?: string;
  from?: string;
  to?: string;
  previousFrom?: string;
  previousTo?: string;
}) {
  const current = toolPeriod(input);
  const previous =
    input.previousFrom && input.previousTo
      ? businessPeriodFromIsoRange({
          from: input.previousFrom,
          to: input.previousTo,
          label: `${input.previousFrom} a ${input.previousTo}`,
          timezone: current.timezone,
        })
      : previousComparablePeriod(current);
  return { current, previous };
}

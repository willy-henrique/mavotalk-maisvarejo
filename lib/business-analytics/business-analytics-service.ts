import { randomUUID } from "node:crypto";
import { queryTenantDatabase } from "@/lib/db";
import { assertBusinessPermission } from "@/lib/business-access/business-permissions";
import { daysInPeriod } from "@/lib/business-analytics/business-period-parser";
import { averagePerCalendarDay } from "@/lib/business-analytics/business-calculations";
import { sanitizeBusinessAuditInput } from "@/lib/observability";
import type {
  AverageDailySalesResult,
  AverageTicketResult,
  BusinessAnalyticsContext,
  BusinessPeriod,
  BusinessSummary,
  DataFreshness,
  InventoryEntryItem,
  ProductSalesItem,
  SalesByDayItem,
  SalesByWeekdayItem,
  SalesComparison,
  SalesTotals,
} from "@/lib/business-analytics/types";

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function limited(value: number, fallback = 10): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(1, Math.min(20, value));
}

const weekdayNames = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];

async function auditQuery(input: {
  context: BusinessAnalyticsContext;
  queryType: string;
  sanitizedInput?: string;
  parameters: Record<string, unknown>;
  status: "success" | "empty" | "denied" | "failed";
  durationMs: number;
  errorCode?: string;
  resultSummary?: Record<string, unknown>;
}): Promise<void> {
  await queryTenantDatabase(
    input.context.organizationId,
    `INSERT INTO business_query_audit (
       id, organization_id, access_user_id, application_user_id,
       phone_normalized, conversation_reference, origin, query_type,
       sanitized_input, parameters_json, result_summary, status,
       error_code, duration_ms
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb,
       $12, $13, $14
     )`,
    [
      randomUUID(),
      input.context.organizationId,
      input.context.accessUserId || null,
      input.context.applicationUserId || null,
      input.context.phoneNormalized || null,
      input.context.conversationReference || null,
      input.context.origin,
      input.queryType,
      sanitizeBusinessAuditInput(input.sanitizedInput),
      JSON.stringify(input.parameters),
      JSON.stringify(input.resultSummary || {}),
      input.status,
      input.errorCode || null,
      input.durationMs,
    ],
  );
}

async function runAudited<T>(input: {
  context: BusinessAnalyticsContext;
  queryType: string;
  period?: BusinessPeriod;
  sanitizedInput?: string;
  parameters?: Record<string, unknown>;
  execute: () => Promise<T>;
  summarize: (value: T) => { empty: boolean; itemCount?: number };
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await input.execute();
    const summary = input.summarize(value);
    await auditQuery({
      context: input.context,
      queryType: input.queryType,
      sanitizedInput: input.sanitizedInput,
      parameters: {
        ...(input.period
          ? { from: input.period.from, to: input.period.to }
          : {}),
        ...(input.parameters || {}),
      },
      status: summary.empty ? "empty" : "success",
      durationMs: Date.now() - startedAt,
      resultSummary: {
        hasData: !summary.empty,
        itemCount: summary.itemCount ?? (summary.empty ? 0 : 1),
      },
    });
    return value;
  } catch (error) {
    await auditQuery({
      context: input.context,
      queryType: input.queryType,
      sanitizedInput: input.sanitizedInput,
      parameters: {
        ...(input.period
          ? { from: input.period.from, to: input.period.to }
          : {}),
        ...(input.parameters || {}),
      },
      status:
        (error as { code?: string }).code === "BUSINESS_PERMISSION_DENIED"
          ? "denied"
          : "failed",
      durationMs: Date.now() - startedAt,
      errorCode: String((error as { code?: string }).code || "QUERY_FAILED"),
    }).catch(() => undefined);
    throw error;
  }
}

async function salesTotalsQuery(
  organizationId: string,
  period: BusinessPeriod,
): Promise<SalesTotals> {
  const result = await queryTenantDatabase<{
    gross_total: string | null;
    net_total: string | null;
    discount_total: string | null;
    cancelled_total: string | null;
    sales_count: string | null;
    items_quantity: string | null;
    synchronized_days: string;
  }>(
    organizationId,
    `SELECT COALESCE(SUM(gross_total), 0)::text AS gross_total,
            COALESCE(SUM(net_total), 0)::text AS net_total,
            COALESCE(SUM(discount_total), 0)::text AS discount_total,
            COALESCE(SUM(cancelled_total), 0)::text AS cancelled_total,
            COALESCE(SUM(sales_count), 0)::text AS sales_count,
            COALESCE(SUM(items_quantity), 0)::text AS items_quantity,
            COUNT(*)::text AS synchronized_days
       FROM business_sales_daily
      WHERE organization_id = $1
        AND sale_date BETWEEN $2::date AND $3::date`,
    [organizationId, period.from, period.to],
  );
  const row = result.rows[0];
  const synchronizedDays = Number(row?.synchronized_days || 0);
  return {
    period,
    grossTotal: numberValue(row?.gross_total),
    netTotal: numberValue(row?.net_total),
    discountTotal: numberValue(row?.discount_total),
    cancelledTotal: numberValue(row?.cancelled_total),
    salesCount: numberValue(row?.sales_count),
    itemsQuantity: numberValue(row?.items_quantity),
    hasData: synchronizedDays > 0,
  };
}

export class BusinessAnalyticsService {
  async getSalesTotal(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<SalesTotals> {
    return runAudited({
      context,
      queryType: "sales_total",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        return salesTotalsQuery(context.organizationId, period);
      },
      summarize: (value) => ({ empty: !value.hasData }),
    });
  }

  async getSalesCount(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<{ period: BusinessPeriod; salesCount: number; hasData: boolean }> {
    return runAudited({
      context,
      queryType: "sales_count",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "sales.read");
        const totals = await salesTotalsQuery(context.organizationId, period);
        return {
          period,
          salesCount: totals.salesCount,
          hasData: totals.hasData,
        };
      },
      summarize: (value) => ({ empty: !value.hasData }),
    });
  }

  async getAverageTicket(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<AverageTicketResult> {
    return runAudited({
      context,
      queryType: "average_ticket",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const totals = await salesTotalsQuery(context.organizationId, period);
        return {
          period,
          averageTicket:
            totals.salesCount > 0 ? totals.netTotal / totals.salesCount : 0,
          salesCount: totals.salesCount,
          hasData: totals.hasData,
        };
      },
      summarize: (value) => ({ empty: !value.hasData }),
    });
  }

  async getAverageSalesPerDay(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<AverageDailySalesResult> {
    return runAudited({
      context,
      queryType: "average_daily_sales",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const [totals, synchronized] = await Promise.all([
          salesTotalsQuery(context.organizationId, period),
          queryTenantDatabase<{ count: string }>(
            context.organizationId,
            `SELECT COUNT(*)::text AS count
               FROM business_sales_daily
              WHERE organization_id = $1
                AND sale_date BETWEEN $2::date AND $3::date`,
            [context.organizationId, period.from, period.to],
          ),
        ]);
        const calendarDays = daysInPeriod(period);
        return {
          period,
          averagePerDay: averagePerCalendarDay(totals.netTotal, period),
          calendarDays,
          synchronizedDays: Number(synchronized.rows[0]?.count || 0),
          netTotal: totals.netTotal,
          hasData: totals.hasData,
        };
      },
      summarize: (value) => ({ empty: !value.hasData }),
    });
  }

  async getSalesByDay(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    limit = 20,
    sanitizedInput?: string,
  ): Promise<SalesByDayItem[]> {
    return runAudited({
      context,
      queryType: "sales_by_day",
      period,
      sanitizedInput,
      parameters: { limit: limited(limit, 20) },
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const result = await queryTenantDatabase<{
          sale_date: Date | string;
          net_total: string;
          gross_total: string;
          sales_count: number;
        }>(
          context.organizationId,
          `SELECT sale_date, net_total::text, gross_total::text, sales_count
             FROM business_sales_daily
            WHERE organization_id = $1
              AND sale_date BETWEEN $2::date AND $3::date
            ORDER BY sale_date DESC
            LIMIT $4`,
          [context.organizationId, period.from, period.to, limited(limit, 20)],
        );
        return result.rows.map((row) => ({
          date:
            row.sale_date instanceof Date
              ? row.sale_date.toISOString().slice(0, 10)
              : String(row.sale_date).slice(0, 10),
          netTotal: numberValue(row.net_total),
          grossTotal: numberValue(row.gross_total),
          salesCount: numberValue(row.sales_count),
        }));
      },
      summarize: (value) => ({ empty: value.length === 0, itemCount: value.length }),
    });
  }

  async getSalesByWeekday(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<SalesByWeekdayItem[]> {
    return runAudited({
      context,
      queryType: "sales_by_weekday",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const result = await queryTenantDatabase<{
          weekday: number;
          net_total: string;
          sales_count: string;
        }>(
          context.organizationId,
          `SELECT EXTRACT(DOW FROM sale_date)::int AS weekday,
                  SUM(net_total)::text AS net_total,
                  SUM(sales_count)::text AS sales_count
             FROM business_sales_daily
            WHERE organization_id = $1
              AND sale_date BETWEEN $2::date AND $3::date
            GROUP BY EXTRACT(DOW FROM sale_date)
            ORDER BY SUM(net_total) DESC`,
          [context.organizationId, period.from, period.to],
        );
        return result.rows.map((row) => ({
          weekday: Number(row.weekday),
          weekdayName: weekdayNames[Number(row.weekday)] || "desconhecido",
          netTotal: numberValue(row.net_total),
          salesCount: numberValue(row.sales_count),
        }));
      },
      summarize: (value) => ({ empty: value.length === 0, itemCount: value.length }),
    });
  }

  async getTopSellingProducts(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    limit = 10,
    sanitizedInput?: string,
  ): Promise<ProductSalesItem[]> {
    return this.productRanking(
      context,
      period,
      limited(limit),
      "desc",
      sanitizedInput,
    );
  }

  async getLowSellingProducts(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    limit = 10,
    sanitizedInput?: string,
  ): Promise<ProductSalesItem[]> {
    return this.productRanking(
      context,
      period,
      limited(limit),
      "asc",
      sanitizedInput,
    );
  }

  private async productRanking(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    limit: number,
    direction: "asc" | "desc",
    sanitizedInput?: string,
  ): Promise<ProductSalesItem[]> {
    const queryType =
      direction === "desc" ? "top_selling_products" : "low_selling_products";
    return runAudited({
      context,
      queryType,
      period,
      sanitizedInput,
      parameters: { limit },
      execute: async () => {
        assertBusinessPermission(context.permissions, "sales.read");
        const result = await queryTenantDatabase<{
          product_id: string;
          sku: string | null;
          product_name: string;
          quantity: string;
          net_total: string;
        }>(
          context.organizationId,
          `WITH catalog AS (
             SELECT DISTINCT ON (product_id)
                    product_id, sku, product_name
               FROM business_product_sales_daily
              WHERE organization_id = $1
              ORDER BY product_id, sale_date DESC
           ),
           period_sales AS (
             SELECT product_id, SUM(quantity) AS quantity,
                    SUM(net_total) AS net_total
               FROM business_product_sales_daily
              WHERE organization_id = $1
                AND sale_date BETWEEN $2::date AND $3::date
              GROUP BY product_id
           )
           SELECT c.product_id, c.sku, c.product_name,
                  COALESCE(p.quantity, 0)::text AS quantity,
                  COALESCE(p.net_total, 0)::text AS net_total
             FROM catalog c
             LEFT JOIN period_sales p ON p.product_id = c.product_id
            ORDER BY COALESCE(p.quantity, 0) ${direction === "desc" ? "DESC" : "ASC"},
                     c.product_name ASC
            LIMIT $4`,
          [context.organizationId, period.from, period.to, limit],
        );
        return result.rows.map((row) => ({
          productId: row.product_id,
          sku: row.sku,
          productName: row.product_name,
          quantity: numberValue(row.quantity),
          netTotal: context.permissions.has("finance.read")
            ? numberValue(row.net_total)
            : null,
        }));
      },
      summarize: (value) => ({ empty: value.length === 0, itemCount: value.length }),
    });
  }

  async getInventoryEntries(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    limit = 10,
    sanitizedInput?: string,
  ): Promise<InventoryEntryItem[]> {
    return runAudited({
      context,
      queryType: "inventory_entries",
      period,
      sanitizedInput,
      parameters: { limit: limited(limit) },
      execute: async () => {
        assertBusinessPermission(context.permissions, "inventory.read");
        const result = await queryTenantDatabase<{
          product_id: string;
          sku: string | null;
          product_name: string;
          quantity_entered: string;
          total_cost: string | null;
        }>(
          context.organizationId,
          `SELECT product_id, MAX(sku) AS sku, MAX(product_name) AS product_name,
                  SUM(quantity_entered)::text AS quantity_entered,
                  CASE WHEN COUNT(total_cost) = 0 THEN NULL
                       ELSE SUM(total_cost)::text END AS total_cost
             FROM business_inventory_entries_daily
            WHERE organization_id = $1
              AND entry_date BETWEEN $2::date AND $3::date
            GROUP BY product_id
            ORDER BY SUM(quantity_entered) DESC, MAX(product_name)
            LIMIT $4`,
          [context.organizationId, period.from, period.to, limited(limit)],
        );
        return result.rows.map((row) => ({
          productId: row.product_id,
          sku: row.sku,
          productName: row.product_name,
          quantityEntered: numberValue(row.quantity_entered),
          totalCost:
            row.total_cost == null || !context.permissions.has("finance.read")
              ? null
              : numberValue(row.total_cost),
        }));
      },
      summarize: (value) => ({ empty: value.length === 0, itemCount: value.length }),
    });
  }

  async compareSalesPeriods(
    context: BusinessAnalyticsContext,
    currentPeriod: BusinessPeriod,
    previousPeriod: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<SalesComparison> {
    return runAudited({
      context,
      queryType: "compare_sales_periods",
      period: currentPeriod,
      sanitizedInput,
      parameters: {
        previousFrom: previousPeriod.from,
        previousTo: previousPeriod.to,
      },
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const [current, previous] = await Promise.all([
          salesTotalsQuery(context.organizationId, currentPeriod),
          salesTotalsQuery(context.organizationId, previousPeriod),
        ]);
        const variation = (now: number, before: number) =>
          before === 0 ? null : ((now - before) / before) * 100;
        return {
          current,
          previous,
          netTotalVariationPercent: variation(
            current.netTotal,
            previous.netTotal,
          ),
          salesCountVariationPercent: variation(
            current.salesCount,
            previous.salesCount,
          ),
        };
      },
      summarize: (value) => ({
        empty: !value.current.hasData && !value.previous.hasData,
      }),
    });
  }

  async getDataFreshness(
    context: BusinessAnalyticsContext,
  ): Promise<DataFreshness> {
    return runAudited({
      context,
      queryType: "data_freshness",
      execute: async () => {
        assertBusinessPermission(context.permissions, "sales.read");
        const result = await queryTenantDatabase<{
          last_source_update: Date | null;
          last_agent_sync: Date | null;
          agent_status: string | null;
        }>(
          context.organizationId,
          `SELECT (
                    SELECT MAX(source_updated_at)
                      FROM business_sales_daily
                     WHERE organization_id = $1
                  ) AS last_source_update,
                  (
                    SELECT MAX(last_sync_at)
                      FROM agent_installations
                     WHERE organization_id = $1 AND revoked_at IS NULL
                  ) AS last_agent_sync,
                  (
                    SELECT status
                      FROM agent_installations
                     WHERE organization_id = $1 AND revoked_at IS NULL
                     ORDER BY last_heartbeat_at DESC NULLS LAST
                     LIMIT 1
                  ) AS agent_status`,
          [context.organizationId],
        );
        const row = result.rows[0];
        return {
          lastSourceUpdate: row?.last_source_update?.toISOString() || null,
          lastAgentSync: row?.last_agent_sync?.toISOString() || null,
          agentStatus: row?.agent_status || null,
        };
      },
      summarize: (value) => ({ empty: !value.lastSourceUpdate }),
    });
  }

  async getBusinessSummary(
    context: BusinessAnalyticsContext,
    period: BusinessPeriod,
    sanitizedInput?: string,
  ): Promise<BusinessSummary> {
    return runAudited({
      context,
      queryType: "business_summary",
      period,
      sanitizedInput,
      execute: async () => {
        assertBusinessPermission(context.permissions, "finance.read");
        const [totals, topProducts, weekdays, freshness] = await Promise.all([
          salesTotalsQuery(context.organizationId, period),
          this.getTopSellingProducts(context, period, 1),
          this.getSalesByWeekday(context, period),
          this.getDataFreshness(context),
        ]);
        return {
          totals,
          averageTicket:
            totals.salesCount > 0 ? totals.netTotal / totals.salesCount : 0,
          averagePerDay: averagePerCalendarDay(totals.netTotal, period),
          topProduct: topProducts[0] || null,
          bestWeekday: weekdays[0] || null,
          lastDataUpdate: freshness.lastSourceUpdate,
        };
      },
      summarize: (value) => ({ empty: !value.totals.hasData }),
    });
  }
}

export const businessAnalyticsService = new BusinessAnalyticsService();

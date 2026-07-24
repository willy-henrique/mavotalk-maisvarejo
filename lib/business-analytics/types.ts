import type { BusinessPermission } from "@/lib/business-access/types";

export type BusinessPeriod = {
  from: string;
  to: string;
  label: string;
  timezone: string;
};

export type BusinessAnalyticsContext = {
  organizationId: string;
  accessUserId?: string;
  applicationUserId?: string;
  phoneNormalized?: string;
  conversationReference?: string;
  origin: "whatsapp" | "ui" | "mcp" | "api";
  permissions: ReadonlySet<BusinessPermission>;
};

export type SalesTotals = {
  period: BusinessPeriod;
  grossTotal: number;
  netTotal: number;
  discountTotal: number;
  cancelledTotal: number;
  salesCount: number;
  itemsQuantity: number;
  hasData: boolean;
};

export type AverageTicketResult = {
  period: BusinessPeriod;
  averageTicket: number;
  salesCount: number;
  hasData: boolean;
};

export type AverageDailySalesResult = {
  period: BusinessPeriod;
  averagePerDay: number;
  calendarDays: number;
  synchronizedDays: number;
  netTotal: number;
  hasData: boolean;
};

export type SalesByDayItem = {
  date: string;
  netTotal: number;
  grossTotal: number;
  salesCount: number;
};

export type SalesByWeekdayItem = {
  weekday: number;
  weekdayName: string;
  netTotal: number;
  salesCount: number;
};

export type ProductSalesItem = {
  productId: string;
  sku: string | null;
  productName: string;
  quantity: number;
  netTotal: number | null;
};

export type InventoryEntryItem = {
  productId: string;
  sku: string | null;
  productName: string;
  quantityEntered: number;
  totalCost: number | null;
};

export type SalesComparison = {
  current: SalesTotals;
  previous: SalesTotals;
  netTotalVariationPercent: number | null;
  salesCountVariationPercent: number | null;
};

export type BusinessSummary = {
  totals: SalesTotals;
  averageTicket: number;
  averagePerDay: number;
  topProduct: ProductSalesItem | null;
  bestWeekday: SalesByWeekdayItem | null;
  lastDataUpdate: string | null;
};

export type DataFreshness = {
  lastSourceUpdate: string | null;
  lastAgentSync: string | null;
  agentStatus: string | null;
};

export type BusinessQueryIntent =
  | "business_summary"
  | "sales_total"
  | "sales_count"
  | "average_ticket"
  | "average_daily_sales"
  | "sales_by_day"
  | "sales_by_weekday"
  | "top_selling_products"
  | "low_selling_products"
  | "inventory_entries"
  | "compare_sales_periods"
  | "data_freshness"
  | "help"
  | "unknown";

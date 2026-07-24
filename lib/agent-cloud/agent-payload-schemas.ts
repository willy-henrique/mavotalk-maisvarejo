import { z } from "zod";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTimestamp = z.string().datetime({ offset: true });
const money = z.number().finite();
const quantity = z.number().finite();

const envelopeFields = {
  schemaVersion: z.literal("1.0"),
  batchId: z.string().uuid(),
  agentVersion: z.string().min(1).max(50),
  generatedAt: isoTimestamp,
  sourceTimezone: z.string().min(1).max(100),
  range: z
    .object({ from: isoDate, to: isoDate })
    .strict()
    .refine((range) => range.to >= range.from, "Intervalo inválido"),
  checksum: z.string().regex(/^[a-f0-9]{64}$/i),
};

export const heartbeatPayloadSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    agentVersion: z.string().min(1).max(50),
    generatedAt: isoTimestamp,
    sourceTimezone: z.string().min(1).max(100),
    status: z.enum(["healthy", "degraded"]).default("healthy"),
    details: z
      .object({
        firebirdConnected: z.boolean().optional(),
        pendingBatches: z.number().int().min(0).max(1_000_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const salesDailyRecordSchema = z
  .object({
    saleDate: isoDate,
    grossTotal: money,
    netTotal: money,
    discountTotal: money.default(0),
    cancelledTotal: money.default(0),
    salesCount: z.number().int().min(0),
    itemsQuantity: quantity.min(0),
    averageTicket: money,
    sourceUpdatedAt: isoTimestamp,
  })
  .strict();

export const productSalesRecordSchema = z
  .object({
    saleDate: isoDate,
    productId: z.string().min(1).max(200),
    sku: z.string().max(200).nullable().optional(),
    productName: z.string().min(1).max(500),
    quantity,
    grossTotal: money,
    netTotal: money,
    sourceUpdatedAt: isoTimestamp,
  })
  .strict();

export const inventoryEntryRecordSchema = z
  .object({
    entryDate: isoDate,
    productId: z.string().min(1).max(200),
    sku: z.string().max(200).nullable().optional(),
    productName: z.string().min(1).max(500),
    quantityEntered: quantity.min(0),
    totalCost: money.nullable().optional(),
    sourceUpdatedAt: isoTimestamp,
  })
  .strict();

function envelopeFor<T extends z.ZodType>(record: T) {
  return z
    .object({
      ...envelopeFields,
      records: z.array(record).max(5_000),
    })
    .strict()
    .superRefine((payload, context) => {
      payload.records.forEach((item, index) => {
        const typedItem = item as Record<string, unknown>;
        const recordDate =
          "saleDate" in typedItem
            ? String(typedItem.saleDate)
            : "entryDate" in typedItem
              ? String(typedItem.entryDate)
              : "";
        if (
          recordDate &&
          (recordDate < payload.range.from || recordDate > payload.range.to)
        ) {
          context.addIssue({
            code: "custom",
            path: ["records", index],
            message: "Registro fora do intervalo declarado",
          });
        }
      });
    });
}

export const salesDailyPayloadSchema = envelopeFor(salesDailyRecordSchema);
export const productSalesPayloadSchema = envelopeFor(productSalesRecordSchema);
export const inventoryEntriesPayloadSchema = envelopeFor(
  inventoryEntryRecordSchema,
);

export type SalesDailyPayload = z.infer<typeof salesDailyPayloadSchema>;
export type ProductSalesPayload = z.infer<typeof productSalesPayloadSchema>;
export type InventoryEntriesPayload = z.infer<
  typeof inventoryEntriesPayloadSchema
>;
export type AgentSyncPayload =
  | SalesDailyPayload
  | ProductSalesPayload
  | InventoryEntriesPayload;

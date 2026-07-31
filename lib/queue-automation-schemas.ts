import { z } from "zod";

export const QUEUE_AUTOMATION_TYPES = ["custom", "offers_promotions", "business_hours_location"] as const;
export type QueueAutomationType = (typeof QUEUE_AUTOMATION_TYPES)[number];
export type QueueConfigurationStatus = "draft" | "published";

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM.");
const nullableText = (max: number) => z.string().trim().max(max).nullable();
const optionalNullableText = (max: number) => nullableText(max).optional();
const httpUrl = z.string().trim().url().refine((value) => /^https?:\/\//i.test(value), "Use http ou https.");

export const queueGeneralConfigSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: optionalNullableText(500),
  menuOption: z.number().int().min(1).max(99),
  defaultSlaMins: z.number().int().min(5).max(1440),
  colorHex: z.string().regex(/^#([A-Fa-f0-9]{6})$/),
  icon: z.string().trim().max(32).nullable().optional(),
  isActive: z.boolean(),
  allowReturnToMenu: z.boolean(),
  createTicketOnHumanHandoff: z.boolean(),
}).strict();
export type QueueGeneralConfig = z.infer<typeof queueGeneralConfigSchema>;

const commonAutomationSchema = z.object({
  initialMessage: z.string().trim().min(1).max(4_000),
  noContentMessage: z.string().trim().min(1).max(4_000),
  closingMessage: optionalNullableText(4_000),
  allowHumanHandoff: z.boolean(),
  showReturnToMenu: z.boolean(),
  useAiFallback: z.boolean(),
  enabled: z.boolean(),
});

export const offersAutomationConfigSchema = commonAutomationSchema.extend({
  beforeFlyerMessage: optionalNullableText(4_000),
  afterFlyerMessage: optionalNullableText(4_000),
  showValidity: z.boolean(),
  maxFlyers: z.number().int().min(1).max(20),
  deliveryMode: z.enum(["latest", "all"]),
  orderBy: z.enum(["display_order", "most_recent"]),
  returnToMenuAfterSend: z.boolean(),
}).strict();
export type OffersAutomationConfig = z.infer<typeof offersAutomationConfigSchema>;

export const businessHoursAutomationConfigSchema = commonAutomationSchema.extend({
  openMessage: z.string().trim().min(1).max(4_000),
  closedMessage: z.string().trim().min(1).max(4_000),
  intervalMessage: z.string().trim().min(1).max(4_000),
  specialHoursMessage: z.string().trim().min(1).max(4_000),
  showPhone: z.boolean(),
  showAddress: z.boolean(),
  showReferencePoint: z.boolean(),
  showMapsUrl: z.boolean(),
  showNextOpening: z.boolean(),
}).strict();
export type BusinessHoursAutomationConfig = z.infer<typeof businessHoursAutomationConfigSchema>;

export const customAutomationConfigSchema = commonAutomationSchema.strict();
export type CustomAutomationConfig = z.infer<typeof customAutomationConfigSchema>;

export const queueConfigurationInputSchema = z.object({
  queueType: z.enum(QUEUE_AUTOMATION_TYPES),
  generalConfig: queueGeneralConfigSchema,
  automationConfig: z.union([offersAutomationConfigSchema, businessHoursAutomationConfigSchema, customAutomationConfigSchema]),
}).strict().superRefine((value, ctx) => {
  if (value.queueType === "offers_promotions" && !offersAutomationConfigSchema.safeParse(value.automationConfig).success) {
    ctx.addIssue({ code: "custom", path: ["automationConfig"], message: "Automação de ofertas inválida." });
  }
  if (value.queueType === "business_hours_location" && !businessHoursAutomationConfigSchema.safeParse(value.automationConfig).success) {
    ctx.addIssue({ code: "custom", path: ["automationConfig"], message: "Automação de horários inválida." });
  }
});
export type QueueConfigurationInput = z.infer<typeof queueConfigurationInputSchema>;

export const promotionInputSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: optionalNullableText(4_000),
  caption: optionalNullableText(4_000),
  startsAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  active: z.boolean().default(true),
  displayOrder: z.number().int().min(0).max(9999).default(0),
  handoffEnabled: z.boolean().default(true),
  afterSendMessage: optionalNullableText(4_000),
}).strict().superRefine((value, ctx) => {
  if (new Date(value.expiresAt) <= new Date(value.startsAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "A expiração deve ser posterior ao início." });
  }
});
export type PromotionInput = z.infer<typeof promotionInputSchema>;
export const promotionPatchInputSchema = z.object({
  title: z.string().trim().min(2).max(180), description: optionalNullableText(4_000), caption: optionalNullableText(4_000),
  startsAt: z.string().datetime({ offset: true }), expiresAt: z.string().datetime({ offset: true }), active: z.boolean(), displayOrder: z.number().int().min(0).max(9999), handoffEnabled: z.boolean(), afterSendMessage: optionalNullableText(4_000),
}).strict().partial().refine((value) => Object.keys(value).length > 0, "Informe ao menos um campo.");

export const businessLocationSchema = z.object({
  unitName: z.string().trim().min(1).max(160),
  displayName: optionalNullableText(160),
  address: z.string().trim().min(1).max(300),
  number: optionalNullableText(30),
  complement: optionalNullableText(160),
  district: optionalNullableText(160),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/).transform((value) => value.toUpperCase()),
  postalCode: optionalNullableText(16),
  referencePoint: optionalNullableText(300),
  phone: optionalNullableText(40),
  whatsapp: optionalNullableText(40),
  mapsUrl: httpUrl.nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  timezone: z.string().trim().min(1).max(100).refine((value) => {
    try { Intl.DateTimeFormat(undefined, { timeZone: value }); return true; } catch { return false; }
  }, "Fuso horário inválido."),
}).strict();
export type BusinessLocationInput = z.infer<typeof businessLocationSchema>;

export const businessHoursSchema = z.array(z.object({
  weekday: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  openingTime: time.nullable(),
  closingTime: time.nullable(),
  secondOpeningTime: time.nullable().optional(),
  secondClosingTime: time.nullable().optional(),
}).strict()).length(7).superRefine((rows, ctx) => {
  const weekdays = new Set<number>();
  for (const [index, row] of rows.entries()) {
    if (weekdays.has(row.weekday)) ctx.addIssue({ code: "custom", path: [index, "weekday"], message: "Dia duplicado." });
    weekdays.add(row.weekday);
    if (row.isOpen && (!row.openingTime || !row.closingTime || row.openingTime >= row.closingTime)) ctx.addIssue({ code: "custom", path: [index], message: "Período principal inválido." });
    const hasSecond = Boolean(row.secondOpeningTime || row.secondClosingTime);
    if (hasSecond && (!row.secondOpeningTime || !row.secondClosingTime || row.secondOpeningTime >= row.secondClosingTime || !row.closingTime || row.secondOpeningTime < row.closingTime)) ctx.addIssue({ code: "custom", path: [index], message: "Segundo período inválido." });
  }
});
export type BusinessHoursInput = z.infer<typeof businessHoursSchema>;

export const businessHourExceptionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1).max(160),
  isClosed: z.boolean(),
  openingTime: time.nullable(),
  closingTime: time.nullable(),
}).strict().superRefine((value, ctx) => {
  if (!value.isClosed && (!value.openingTime || !value.closingTime || value.openingTime >= value.closingTime)) ctx.addIssue({ code: "custom", path: ["openingTime"], message: "Horário especial inválido." });
});
export type BusinessHourExceptionInput = z.infer<typeof businessHourExceptionSchema>;

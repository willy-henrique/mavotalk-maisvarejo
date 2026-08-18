import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(6),
});

export const queueSchema = z.object({
  name: z.string().min(2).max(100),
  menuOption: z.number().int().min(1).max(99),
  colorHex: z.string().regex(/^#([A-Fa-f0-9]{6})$/),
  defaultSlaMins: z.number().int().min(5).max(1440),
  isActive: z.boolean().optional(),
  queueType: z.enum(["custom", "offers_promotions", "business_hours_location"]).optional(),
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
  /** Override da assinatura para este envio. Ausente usa o padrão da organização. */
  withSignature: z.boolean().optional(),
});

export const startConversationSchema = z.object({
  /** DDD + número brasileiro ou E.164 com DDI, apenas dígitos. */
  phone: z
    .string()
    .trim()
    .min(10)
    .max(32)
    .regex(/^[+()\d\s.-]+$/, "O número contém caracteres inválidos.")
    .refine(
      (value) => /^\d{10,15}$/.test(value.replace(/\D/g, "")),
      "Informe DDD + número ou DDI + DDD + número.",
    ),
  message: z.string().trim().min(1).max(4_000),
  contactName: z.string().trim().max(200).optional(),
});

export const closeConversationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  sendSurvey: z.boolean().optional(),
});

export const updateContactSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phoneNumber: z.string().min(1).max(30).optional(),
  blocked: z.boolean().optional(),
  botDisabled: z.boolean().optional(),
  internalNote: z.string().max(2000).nullable().optional(),
});

export const adminCreateUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(200),
  role: z.enum(["admin", "gestor", "atendente"]).default("atendente"),
});

export const quickReplySchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1).max(4_000),
  category: z.string().max(50).nullable().optional(),
});

export const adminUpdateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    email: z.string().email().max(254).optional(),
    password: z.string().min(8).max(200).optional(),
    role: z.enum(["admin", "gestor", "atendente"]).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "Nenhum campo informado",
  });

const isoDateTime = z.string().datetime({ offset: true });
const promotionBaseSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(4000).nullable().optional(),
  startsAt: isoDateTime,
  expiresAt: isoDateTime,
  status: z.enum(["draft", "scheduled", "active"]).optional(),
});

export const promotionSchema = promotionBaseSchema.refine(
  (value) => new Date(value.expiresAt) > new Date(value.startsAt),
  { message: "A expiração deve ser posterior ao início", path: ["expiresAt"] },
);

// Zod 4 adiciona checks ao objeto quando `refine` é chamado. Não reutilize o
// mesmo objeto-base aqui: `.partial()` sobre um objeto que já recebeu checks
// falha durante a avaliação estática do Next.
export const promotionPatchSchema = z.object({
  title: z.string().trim().min(2).max(180),
  description: z.string().trim().max(4000).nullable().optional(),
  startsAt: isoDateTime,
  expiresAt: isoDateTime,
  status: z.enum(["draft", "scheduled", "active"]).optional(),
})
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nenhum campo informado",
  })
  .refine(
    (value) =>
      !value.startsAt ||
      !value.expiresAt ||
      new Date(value.expiresAt) > new Date(value.startsAt),
    { message: "A expiração deve ser posterior ao início", path: ["expiresAt"] },
  );

export const deliverySettingsSchema = z.object({
  isActive: z.boolean(),
  minMinutes: z.number().int().min(1).max(1440),
  maxMinutes: z.number().int().min(1).max(1440),
  defaultMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  additionalMarginMinutes: z.number().int().min(0).max(720).optional(),
  timezone: z.string().min(1).max(100),
  dispatchMessage: z.string().trim().max(1000).nullable().optional(),
  schedule: z.array(z.object({ weekday:z.number().int().min(0).max(6), startTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), endTime:z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), isActive:z.boolean() })).max(7),
}).refine((value)=>value.minMinutes<=value.maxMinutes,{message:"O tempo mínimo não pode ser maior que o máximo",path:["minMinutes"]}).refine((value)=>value.schedule.every((item)=>!item.isActive||item.startTime<item.endTime),{message:"Horário de entrega inválido",path:["schedule"]});

export const orderStatusSchema = z.object({ status: z.enum(["received","confirmed","preparing","ready","dispatched","cancelled","delivered"]) });
export const createOrderSchema = z.object({ orderNumber:z.string().trim().min(1).max(100), contactId:z.string().trim().min(1).max(160).nullable().optional(), conversationId:z.string().trim().min(1).max(160).nullable().optional(), notes:z.string().trim().max(4000).nullable().optional() });

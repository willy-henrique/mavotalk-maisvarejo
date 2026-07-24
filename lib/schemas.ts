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
});

export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(4_000),
});

export const closeConversationSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  sendSurvey: z.boolean().optional(),
});

export const updateContactSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  phoneNumber: z.string().min(1).max(30).optional(),
  blocked: z.boolean().optional(),
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


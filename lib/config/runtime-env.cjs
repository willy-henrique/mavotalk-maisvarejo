/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("node:path");
const { z } = require("zod");

const nonEmpty = z.string().trim().min(1);

const commonProductionSchema = z
  .object({
    NODE_ENV: z.literal("production"),
    DB_PROVIDER: z.literal("supabase"),
    DATABASE_URL_RUNTIME: nonEmpty.optional(),
    DATABASE_URL: nonEmpty.optional(),
    REDIS_URL: nonEmpty,
  })
  .passthrough()
  .superRefine((environment, context) => {
    if (!environment.DATABASE_URL_RUNTIME && !environment.DATABASE_URL) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL_RUNTIME"],
        message: "conexão runtime do Supabase é obrigatória",
      });
    }
  });

const apiProductionSchema = commonProductionSchema
  .and(
    z
      .object({
        JWT_SECRET: z.string().min(32),
        MAVO_ALLOWED_ORIGINS: nonEmpty.optional(),
        ALLOWED_ORIGINS: nonEmpty.optional(),
        FRONTEND_URL: nonEmpty.optional(),
        MAVO_AGENT_API_ENABLED: z.string().optional(),
        MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
        WHATSAPP_PROVIDER: z.string().optional(),
        WHATSAPP_AUTH_STORE: z.string().optional(),
        WHATSAPP_AUTH_ENCRYPTION_KEY: z.string().optional(),
        WHATSAPP_AUTH_PATH: z.string().optional(),
        WHATSAPP_ALLOW_EPHEMERAL_SESSION: z.string().optional(),
        RENDER_DISK_PATH: z.string().optional(),
        RENDER: z.string().optional(),
      })
      .passthrough(),
  )
  .superRefine((environment, context) => {
    const origins = String(
      environment.MAVO_ALLOWED_ORIGINS ||
        environment.ALLOWED_ORIGINS ||
        environment.FRONTEND_URL ||
        "",
    )
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean);
    if (!origins.length) {
      context.addIssue({
        code: "custom",
        path: ["MAVO_ALLOWED_ORIGINS"],
        message: "ao menos uma origem é obrigatória",
      });
    }
    for (const origin of origins) {
      try {
        const url = new URL(origin);
        const local =
          url.hostname === "localhost" || url.hostname === "127.0.0.1";
        if (url.origin !== origin || (!local && url.protocol !== "https:")) {
          throw new Error("invalid");
        }
      } catch {
        context.addIssue({
          code: "custom",
          path: ["MAVO_ALLOWED_ORIGINS"],
          message: "origens remotas devem ser URLs HTTPS completas",
        });
        break;
      }
    }

    if (environment.MAVO_AGENT_API_ENABLED === "true") {
      const encoded = environment.MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY || "";
      if (Buffer.from(encoded, "base64").length !== 32) {
        context.addIssue({
          code: "custom",
          path: ["MAVO_AGENT_CREDENTIAL_ENCRYPTION_KEY"],
          message: "deve conter exatamente 32 bytes codificados em base64",
        });
      }
    }

    if ((environment.WHATSAPP_PROVIDER || "unofficial") === "unofficial") {
      const authStore = String(
        environment.WHATSAPP_AUTH_STORE || "database",
      ).toLowerCase();
      if (!["database", "filesystem"].includes(authStore)) {
        context.addIssue({
          code: "custom",
          path: ["WHATSAPP_AUTH_STORE"],
          message: "deve ser 'database' ou 'filesystem'",
        });
      }

      if (authStore === "database") {
        const dedicatedKey = String(
          environment.WHATSAPP_AUTH_ENCRYPTION_KEY || "",
        ).trim();
        const jwtSecret = String(environment.JWT_SECRET || "").trim();
        if (dedicatedKey && Buffer.byteLength(dedicatedKey, "utf8") < 32) {
          context.addIssue({
            code: "custom",
            path: ["WHATSAPP_AUTH_ENCRYPTION_KEY"],
            message: "deve conter ao menos 32 caracteres",
          });
        } else if (
          !dedicatedKey &&
          Buffer.byteLength(jwtSecret, "utf8") < 32
        ) {
          context.addIssue({
            code: "custom",
            path: ["WHATSAPP_AUTH_ENCRYPTION_KEY"],
            message: "ou JWT_SECRET forte deve estar configurada",
          });
        }
      } else {
        const authPath = environment.WHATSAPP_AUTH_PATH || "";
        if (!path.isAbsolute(authPath)) {
          context.addIssue({
            code: "custom",
            path: ["WHATSAPP_AUTH_PATH"],
            message: "deve ser um caminho absoluto em produção",
          });
        }
        // O opt-in explícito permite filesystem sem disco persistente,
        // aceitando que a sessão será perdida em restart/deploy.
        const allowEphemeralSession =
          String(environment.WHATSAPP_ALLOW_EPHEMERAL_SESSION || "")
            .toLowerCase() === "true";
        if (environment.RENDER && !allowEphemeralSession) {
          const diskPath = environment.RENDER_DISK_PATH || "";
          const normalizedDisk = diskPath.replace(/\/$/, "");
          if (
            !normalizedDisk ||
            (authPath !== normalizedDisk &&
              !authPath.startsWith(`${normalizedDisk}/`))
          ) {
            context.addIssue({
              code: "custom",
              path: ["WHATSAPP_AUTH_PATH"],
              message: "deve estar dentro de RENDER_DISK_PATH",
            });
          }
        }
      }
    }
  });

function validationMessage(result) {
  return result.error.issues
    .map((issue) => `${issue.path.join(".") || "ambiente"}: ${issue.message}`)
    .join(", ");
}

function validateApiEnvironment(environment = process.env) {
  if (environment.NODE_ENV !== "production") return;
  const result = apiProductionSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Configuração de produção inválida: ${validationMessage(result)}`);
  }
}

function validateWorkerEnvironment(environment = process.env) {
  if (environment.NODE_ENV !== "production") return;
  const result = commonProductionSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(`Configuração do worker inválida: ${validationMessage(result)}`);
  }
}

module.exports = {
  validateApiEnvironment,
  validateWorkerEnvironment,
};

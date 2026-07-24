export type WhatsappInitializationStage =
  | "auth-store"
  | "version-lookup"
  | "socket";

export type WhatsappDiagnosticCode =
  | "WHATSAPP_AUTH_TABLE_MISSING"
  | "WHATSAPP_AUTH_PERMISSION_DENIED"
  | "WHATSAPP_AUTH_ORGANIZATION_MISSING"
  | "WHATSAPP_AUTH_CONSTRAINT_FAILED"
  | "WHATSAPP_AUTH_KEY_INVALID"
  | "WHATSAPP_AUTH_DECRYPT_FAILED"
  | "WHATSAPP_AUTH_STORE_INIT_FAILED"
  | "WHATSAPP_VERSION_LOOKUP_FAILED"
  | "WHATSAPP_SOCKET_INIT_FAILED";

type ErrorLike = {
  code?: unknown;
  message?: unknown;
};

export function classifyWhatsappInitializationError(
  stage: WhatsappInitializationStage,
  error: unknown,
): WhatsappDiagnosticCode {
  if (stage === "version-lookup") return "WHATSAPP_VERSION_LOOKUP_FAILED";
  if (stage === "socket") return "WHATSAPP_SOCKET_INIT_FAILED";

  const errorLike =
    error && typeof error === "object" ? (error as ErrorLike) : {};
  const postgresCode =
    typeof errorLike.code === "string" ? errorLike.code : "";
  if (postgresCode === "42P01") return "WHATSAPP_AUTH_TABLE_MISSING";
  if (postgresCode === "42501") return "WHATSAPP_AUTH_PERMISSION_DENIED";
  if (postgresCode === "23503") {
    return "WHATSAPP_AUTH_ORGANIZATION_MISSING";
  }
  if (postgresCode === "23514") return "WHATSAPP_AUTH_CONSTRAINT_FAILED";

  const message =
    typeof errorLike.message === "string"
      ? errorLike.message.toLowerCase()
      : "";
  if (message.includes("ao menos 32 caracteres")) {
    return "WHATSAPP_AUTH_KEY_INVALID";
  }
  if (
    message.includes("unable to authenticate data") ||
    message.includes("não foi possível decifrar")
  ) {
    return "WHATSAPP_AUTH_DECRYPT_FAILED";
  }
  return "WHATSAPP_AUTH_STORE_INIT_FAILED";
}

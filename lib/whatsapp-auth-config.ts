import path from "node:path";

export type WhatsappAuthStore = "database" | "filesystem";

type Environment = Readonly<Record<string, string | undefined>>;

export function configuredWhatsappAuthStore(
  environment: Environment = process.env,
): WhatsappAuthStore {
  const configured = String(environment.WHATSAPP_AUTH_STORE || "")
    .trim()
    .toLowerCase();
  if (configured === "database" || configured === "filesystem") {
    return configured;
  }
  return environment.NODE_ENV === "production" &&
    String(environment.DB_PROVIDER || "supabase").toLowerCase() === "supabase"
    ? "database"
    : "filesystem";
}

export function configuredWhatsappAuthPersistence(
  environment: Environment = process.env,
): boolean {
  if (configuredWhatsappAuthStore(environment) === "database") return true;
  const authPath = path.resolve(
    String(environment.WHATSAPP_AUTH_PATH || ".whatsapp_auth"),
  );
  const configuredDiskPath = String(environment.RENDER_DISK_PATH || "")
    .trim()
    .replace(/\/$/, "");
  const diskPath = configuredDiskPath ? path.resolve(configuredDiskPath) : "";
  if (!diskPath) return false;
  const relative = path.relative(diskPath, authPath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export function shouldAutoReconnectWhatsapp(
  loggedOut: boolean,
  manuallyDisconnected: boolean,
): boolean {
  return !loggedOut && !manuallyDisconnected;
}

export function configuredWhatsappAuthKeyMaterials(
  explicitKey?: string,
  environment: Environment = process.env,
): string[] {
  const dedicated =
    String(explicitKey || "").trim() ||
    String(environment.WHATSAPP_AUTH_ENCRYPTION_KEY || "").trim();
  if (dedicated && Buffer.byteLength(dedicated, "utf8") < 32) {
    throw new Error(
      "WHATSAPP_AUTH_ENCRYPTION_KEY deve conter ao menos 32 caracteres",
    );
  }
  const jwtSecret = String(environment.JWT_SECRET || "").trim();
  const candidates = [dedicated, jwtSecret].filter(
    (value) => Buffer.byteLength(value, "utf8") >= 32,
  );
  const unique = [...new Set(candidates)];
  if (!unique.length) {
    throw new Error(
      "WHATSAPP_AUTH_ENCRYPTION_KEY ou JWT_SECRET forte é obrigatório",
    );
  }
  return unique;
}

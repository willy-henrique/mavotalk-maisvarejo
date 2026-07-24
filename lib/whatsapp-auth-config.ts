import path from "node:path";

export type WhatsappAuthStore = "database" | "filesystem";

type Environment = Readonly<Record<string, string | undefined>>;

export function configuredWhatsappAuthStore(
  environment: Environment = process.env,
): WhatsappAuthStore {
  return String(environment.WHATSAPP_AUTH_STORE || "")
    .trim()
    .toLowerCase() === "database"
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

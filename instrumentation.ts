export async function register() {
  if (
    process.env.npm_lifecycle_event === "build" ||
    process.env.NEXT_PHASE === "phase-production-build" ||
    (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs")
  ) {
    return;
  }
  const autoConnect =
    String(process.env.WHATSAPP_AUTO_CONNECT || "true").toLowerCase() === "true";
  if (
    autoConnect &&
    (process.env.WHATSAPP_PROVIDER || "unofficial") === "unofficial"
  ) {
    const { initWhatsappClient } = await import("@/lib/whatsapp-client");
    setTimeout(() => {
      void initWhatsappClient().catch(() => {
        // O status sanitizado fica disponível no painel. A API continua saudável.
      });
    }, 1_000).unref();
  }
}

import test from "node:test";
import assert from "node:assert/strict";
import { classifyWhatsappInitializationError } from "../../lib/whatsapp-diagnostics";

test("classifica falhas de inicialização do WhatsApp sem expor detalhes", () => {
  assert.equal(
    classifyWhatsappInitializationError("auth-store", { code: "42P01" }),
    "WHATSAPP_AUTH_TABLE_MISSING",
  );
  assert.equal(
    classifyWhatsappInitializationError("auth-store", { code: "42501" }),
    "WHATSAPP_AUTH_PERMISSION_DENIED",
  );
  assert.equal(
    classifyWhatsappInitializationError("auth-store", { code: "23503" }),
    "WHATSAPP_AUTH_ORGANIZATION_MISSING",
  );
  assert.equal(
    classifyWhatsappInitializationError("auth-store", {
      message: "Unsupported state or unable to authenticate data",
    }),
    "WHATSAPP_AUTH_DECRYPT_FAILED",
  );
  assert.equal(
    classifyWhatsappInitializationError("version-lookup", new Error("host")),
    "WHATSAPP_VERSION_LOOKUP_FAILED",
  );
  assert.equal(
    classifyWhatsappInitializationError("socket", new Error("segredo")),
    "WHATSAPP_SOCKET_INIT_FAILED",
  );
});

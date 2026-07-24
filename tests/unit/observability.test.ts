import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeBusinessAuditInput,
  sanitizedError,
} from "../../lib/observability";

test("erro sanitizado preserva domínio controlado e oculta detalhes internos", () => {
  assert.deepEqual(
    sanitizedError(
      Object.assign(new Error("Intervalo inválido"), {
        code: "INVALID_PERIOD",
        status: 400,
      }),
    ),
    { code: "INVALID_PERIOD", message: "Intervalo inválido" },
  );
  assert.deepEqual(
    sanitizedError(
      Object.assign(
        new Error(
          "duplicate key violates constraint secret_table_key; SQL INSERT ...",
        ),
        { code: "23505" },
      ),
    ),
    { code: "INTERNAL_ERROR", message: "Erro interno" },
  );
});

test("entrada de auditoria remove PIN, telefone e e-mail", () => {
  const safe = sanitizeBusinessAuditInput(
    "Vendas hoje; PIN: 123456, telefone +55 (11) 99999-9999 e eu@empresa.com",
  );
  assert.doesNotMatch(String(safe), /123456|99999|eu@empresa/);
  assert.match(String(safe), /redigido/);
});

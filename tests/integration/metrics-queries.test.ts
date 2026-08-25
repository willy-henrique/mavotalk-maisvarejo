import test, { after } from "node:test";
import assert from "node:assert/strict";
import { closeDatabasePool } from "../../lib/db";
import { snapshotAgora } from "../../lib/metrics/live";

const rodar = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true";
const organizacao = process.env.METRICS_TEST_ORG_ID || "";

after(async () => {
  if (rodar) await closeDatabasePool();
});

test("snapshot do Agora devolve numeros nao negativos", { skip: !rodar }, async () => {
  assert.ok(organizacao, "METRICS_TEST_ORG_ID é obrigatório para a integração");
  const snapshot = await snapshotAgora(organizacao);
  assert.ok(snapshot.naFila >= 0);
  assert.ok(snapshot.emAtendimento >= 0);
  assert.ok(snapshot.pendenteCliente >= 0);
  assert.ok(snapshot.slaEmRisco >= 0);
  assert.ok(
    snapshot.esperaMaisLongaSegundos === null || snapshot.esperaMaisLongaSegundos >= 0,
  );
});

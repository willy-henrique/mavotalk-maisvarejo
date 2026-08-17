import test from "node:test";
import assert from "node:assert/strict";
import { statusAfterInboundMessage } from "../../lib/conversation-state";

test("mensagem do cliente não devolve atendimento humano para a fila", () => {
  assert.equal(statusAfterInboundMessage("em_atendimento"), "em_atendimento");
});

test("mensagem abre ou reabre estados sem atendimento humano como aguardando", () => {
  assert.equal(statusAfterInboundMessage("aguardando"), "aguardando");
  assert.equal(statusAfterInboundMessage("pendente_cliente"), "aguardando");
  assert.equal(statusAfterInboundMessage("encerrado"), "aguardando");
});

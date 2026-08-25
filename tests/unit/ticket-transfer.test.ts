import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TRANSFER_NOTE_LENGTH,
  parseTransferRequest,
  type TransferCandidate,
} from "../../lib/ticket-transfer";

const equipe: TransferCandidate[] = [
  { id: "u-ana", isActive: true },
  { id: "u-bruno", isActive: true },
  { id: "u-desativado", isActive: false },
];

const contexto = { currentUserId: "u-ana", team: equipe };

// ---------------------------------------------------------------------------
// Transferência para uma pessoa
// ---------------------------------------------------------------------------

test("transferir para um colega ativo é aceito", () => {
  const resultado = parseTransferRequest(
    { toUserId: "u-bruno", note: "cliente quer falar de nota fiscal" },
    contexto,
  );

  assert.deepEqual(resultado, {
    ok: true,
    target: { kind: "user", userId: "u-bruno" },
    note: "cliente quer falar de nota fiscal",
  });
});

test("não dá para transferir para si mesmo", () => {
  // Não é erro de digitação inofensivo: registraria uma transferência no
  // histórico e mandaria uma notificação para quem já está com o chamado.
  const resultado = parseTransferRequest(
    { toUserId: "u-ana", note: "qualquer coisa" },
    contexto,
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /para você mesmo/i);
});

test("não dá para transferir para quem foi desativado", () => {
  const resultado = parseTransferRequest(
    { toUserId: "u-desativado", note: "assumir daqui" },
    contexto,
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /não está ativo/i);
});

test("não dá para transferir para quem não é da equipe", () => {
  // A lista vem da organização da sessão: um id de fora não pode virar dono de
  // um chamado que ele nem consegue abrir.
  const resultado = parseTransferRequest(
    { toUserId: "u-de-outra-empresa", note: "assumir daqui" },
    contexto,
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /não encontrado/i);
});

// ---------------------------------------------------------------------------
// Devolver para a fila
// ---------------------------------------------------------------------------

test("devolver para a fila não precisa de destinatário", () => {
  const resultado = parseTransferRequest(
    { toQueue: true, note: "não é da minha área" },
    contexto,
  );

  assert.deepEqual(resultado, {
    ok: true,
    target: { kind: "queue" },
    note: "não é da minha área",
  });
});

test("pedir os dois destinos ao mesmo tempo é recusado", () => {
  const resultado = parseTransferRequest(
    { toUserId: "u-bruno", toQueue: true, note: "confuso" },
    contexto,
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /um destino/i);
});

test("sem destino nenhum é recusado", () => {
  const resultado = parseTransferRequest({ note: "e agora" }, contexto);

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /um destino/i);
});

// ---------------------------------------------------------------------------
// Motivo
// ---------------------------------------------------------------------------

test("motivo é obrigatório nos dois destinos", () => {
  // Transferência sem motivo obriga quem recebe a reler a conversa inteira para
  // descobrir o que já foi tentado.
  for (const pedido of [{ toUserId: "u-bruno" }, { toQueue: true }]) {
    const resultado = parseTransferRequest({ ...pedido, note: "   " }, contexto);
    assert.equal(resultado.ok, false);
    assert.match(resultado.ok ? "" : resultado.error, /motivo/i);
  }
});

test("o motivo vem sem espaço sobrando nas pontas", () => {
  const resultado = parseTransferRequest(
    { toUserId: "u-bruno", note: "  cliente é do Financeiro  " },
    contexto,
  );

  assert.equal(resultado.ok && resultado.note, "cliente é do Financeiro");
});

test("motivo longo demais é recusado em vez de cortado calado", () => {
  // Cortar em silêncio perderia justamente o fim da explicação.
  const resultado = parseTransferRequest(
    { toUserId: "u-bruno", note: "x".repeat(MAX_TRANSFER_NOTE_LENGTH + 1) },
    contexto,
  );

  assert.equal(resultado.ok, false);
  assert.match(resultado.ok ? "" : resultado.error, /caracteres/i);
});

test("motivo no limite exato passa", () => {
  const resultado = parseTransferRequest(
    { toUserId: "u-bruno", note: "x".repeat(MAX_TRANSFER_NOTE_LENGTH) },
    contexto,
  );

  assert.equal(resultado.ok, true);
});

// ---------------------------------------------------------------------------
// Entrada malformada
// ---------------------------------------------------------------------------

test("tipos errados no corpo não viram transferência", () => {
  const resultado = parseTransferRequest(
    { toUserId: 42 as unknown as string, note: "teste" },
    contexto,
  );

  assert.equal(resultado.ok, false);
});

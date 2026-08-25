import test from "node:test";
import assert from "node:assert/strict";
import { transferBannerFor } from "../../frontend/services/transfer";

const QUANDO = "2026-08-25T12:00:00.000Z";

const transferido = {
  transferredAt: QUANDO,
  transferNote: "cliente quer segunda via de nota",
  transferredFrom: { id: "u-ana", name: "Ana" },
};

test("quem recebeu vê de quem veio e por quê", () => {
  assert.deepEqual(transferBannerFor(transferido, "u-bruno"), {
    fromName: "Ana",
    note: "cliente quer segunda via de nota",
    at: QUANDO,
  });
});

test("quem transferiu não vê a própria faixa", () => {
  // Ela repetiria para a pessoa o texto que ela mesma acabou de escrever.
  assert.equal(transferBannerFor(transferido, "u-ana"), null);
});

test("chamado que nunca foi transferido não mostra faixa", () => {
  assert.equal(transferBannerFor({ transferredAt: null, transferNote: null }, "u-bruno"), null);
  assert.equal(transferBannerFor(null, "u-bruno"), null);
  assert.equal(transferBannerFor(undefined, "u-bruno"), null);
});

test("transferência sem motivo gravado não vira faixa vazia", () => {
  assert.equal(
    transferBannerFor({ transferredAt: QUANDO, transferNote: null }, "u-bruno"),
    null,
  );
});

test("devolvido para a fila por alguém sem nome ainda explica o motivo", () => {
  // O motivo é o que importa na faixa; o nome é contexto.
  const semNome = { ...transferido, transferredFrom: { id: "u-ana", name: null } };

  assert.equal(transferBannerFor(semNome, "u-bruno")?.fromName, "outro técnico");
  assert.equal(transferBannerFor(semNome, "u-bruno")?.note, "cliente quer segunda via de nota");
});
